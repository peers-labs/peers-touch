use std::ffi::{c_void, CStr};
use std::os::raw::{c_long, c_uchar};
use std::ptr;

use crate::error::{MobileError, MobileResult};

#[derive(Clone, Default)]
pub struct SecureStorage;

impl SecureStorage {
    pub fn new() -> Self {
        Self
    }

    pub fn set(&self, key: &str, value: &str) -> MobileResult<()> {
        keychain_set(key, value)
    }

    pub fn get(&self, key: &str) -> MobileResult<Option<String>> {
        keychain_get(key)
    }

    pub fn remove(&self, key: &str) -> MobileResult<()> {
        keychain_remove(key)
    }

    pub fn list(&self, prefix: &str) -> MobileResult<Vec<String>> {
        keychain_list(prefix)
    }
}

type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFMutableDictionaryRef = *mut c_void;
type CFStringRef = *const c_void;
type CFDataRef = *const c_void;
type OSStatus = i32;

const ERR_SEC_SUCCESS: OSStatus = 0;
const ERR_SEC_DUPLICATE_ITEM: OSStatus = -25299;
const ERR_SEC_ITEM_NOT_FOUND: OSStatus = -25300;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const SERVICE_NAME: &str = "com.peers.touch.mobile.secure-storage";

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    static kCFBooleanFalse: CFTypeRef;
    static kCFBooleanTrue: CFTypeRef;

    fn CFDataCreate(allocator: CFTypeRef, bytes: *const u8, length: c_long) -> CFDataRef;
    fn CFDataGetBytePtr(data: CFDataRef) -> *const c_uchar;
    fn CFDataGetLength(data: CFDataRef) -> c_long;
    fn CFArrayGetCount(array: CFArrayRef) -> c_long;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: c_long) -> CFTypeRef;
    fn CFDictionaryCreateMutable(
        allocator: CFTypeRef,
        capacity: c_long,
        key_call_backs: *const c_void,
        value_call_backs: *const c_void,
    ) -> CFMutableDictionaryRef;
    fn CFDictionaryGetValue(dictionary: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
    fn CFDictionarySetValue(dictionary: CFMutableDictionaryRef, key: CFTypeRef, value: CFTypeRef);
    fn CFEqual(first: CFTypeRef, second: CFTypeRef) -> c_uchar;
    fn CFRelease(cf: CFTypeRef);
    fn CFStringGetCString(
        string: CFStringRef,
        buffer: *mut i8,
        buffer_size: c_long,
        encoding: u32,
    ) -> c_uchar;
    fn CFStringGetLength(string: CFStringRef) -> c_long;
    fn CFStringGetMaximumSizeForEncoding(length: c_long, encoding: u32) -> c_long;
    fn CFStringCreateWithBytes(
        allocator: CFTypeRef,
        bytes: *const c_uchar,
        num_bytes: c_long,
        encoding: u32,
        is_external_representation: c_uchar,
    ) -> CFStringRef;
}

#[link(name = "Security", kind = "framework")]
extern "C" {
    static kSecClass: CFTypeRef;
    static kSecClassGenericPassword: CFTypeRef;
    static kSecAttrAccount: CFTypeRef;
    static kSecAttrAccessible: CFTypeRef;
    static kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: CFTypeRef;
    static kSecAttrService: CFTypeRef;
    static kSecAttrSynchronizable: CFTypeRef;
    static kSecValueData: CFTypeRef;
    static kSecReturnAttributes: CFTypeRef;
    static kSecReturnData: CFTypeRef;
    static kSecMatchLimit: CFTypeRef;
    static kSecMatchLimitAll: CFTypeRef;
    static kSecMatchLimitOne: CFTypeRef;

    fn SecItemAdd(attributes: CFMutableDictionaryRef, result: *mut CFTypeRef) -> OSStatus;
    fn SecItemCopyMatching(query: CFMutableDictionaryRef, result: *mut CFTypeRef) -> OSStatus;
    fn SecItemDelete(query: CFMutableDictionaryRef) -> OSStatus;
    fn SecItemUpdate(
        query: CFMutableDictionaryRef,
        attributes_to_update: CFMutableDictionaryRef,
    ) -> OSStatus;
}

fn keychain_set(key: &str, value: &str) -> MobileResult<()> {
    unsafe {
        let query = make_base_query(key)?;
        let value_data = cf_data(value.as_bytes())?;
        CFDictionarySetValue(
            query,
            kSecAttrAccessible,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        );
        CFDictionarySetValue(query, kSecValueData, value_data);

        let status = SecItemAdd(query, ptr::null_mut());
        CFRelease(value_data);
        CFRelease(query);

        if status == ERR_SEC_SUCCESS {
            return Ok(());
        }
        if status != ERR_SEC_DUPLICATE_ITEM {
            return Err(status_error("set", status));
        }

        let query = make_base_query(key)?;
        let attrs = cf_dictionary();
        if attrs.is_null() {
            CFRelease(query);
            return Err(MobileError::secure_storage(
                "keychain update dictionary allocation failed",
            ));
        }
        let value_data = cf_data(value.as_bytes())?;
        CFDictionarySetValue(
            attrs,
            kSecAttrAccessible,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        );
        CFDictionarySetValue(attrs, kSecValueData, value_data);
        let update_status = SecItemUpdate(query, attrs);
        CFRelease(value_data);
        CFRelease(attrs);
        CFRelease(query);

        if update_status == ERR_SEC_SUCCESS {
            Ok(())
        } else {
            Err(status_error("update", update_status))
        }
    }
}

fn keychain_get(key: &str) -> MobileResult<Option<String>> {
    unsafe {
        let query = make_base_query(key)?;
        CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
        CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);

        let mut result: CFTypeRef = ptr::null();
        let status = SecItemCopyMatching(query, &mut result);
        CFRelease(query);

        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(None);
        }
        if status != ERR_SEC_SUCCESS {
            return Err(status_error("get", status));
        }
        if result.is_null() {
            return Ok(None);
        }

        let data = result as CFDataRef;
        let length = CFDataGetLength(data);
        let bytes = CFDataGetBytePtr(data);
        if length < 0 || (length > 0 && bytes.is_null()) {
            CFRelease(result);
            return Err(MobileError::secure_storage(
                "keychain returned invalid data",
            ));
        }
        let slice = if length == 0 {
            &[]
        } else {
            std::slice::from_raw_parts(bytes, length as usize)
        };
        let value = String::from_utf8(slice.to_vec()).map_err(|err| {
            MobileError::secure_storage(format!("keychain value is not utf-8: {err}"))
        })?;
        CFRelease(result);
        Ok(Some(value))
    }
}

fn keychain_remove(key: &str) -> MobileResult<()> {
    unsafe {
        let query = make_base_query(key)?;
        let status = SecItemDelete(query);
        CFRelease(query);
        if status == ERR_SEC_SUCCESS || status == ERR_SEC_ITEM_NOT_FOUND {
            Ok(())
        } else {
            Err(status_error("remove", status))
        }
    }
}

fn keychain_list(prefix: &str) -> MobileResult<Vec<String>> {
    unsafe {
        let query = make_service_query()?;
        CFDictionarySetValue(query, kSecReturnAttributes, kCFBooleanTrue);
        CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitAll);

        let mut result: CFTypeRef = ptr::null();
        let status = SecItemCopyMatching(query, &mut result);
        CFRelease(query);
        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(Vec::new());
        }
        if status != ERR_SEC_SUCCESS {
            return Err(status_error("list", status));
        }
        if result.is_null() {
            return Ok(Vec::new());
        }

        let keys = (|| {
            let array = result as CFArrayRef;
            let count = CFArrayGetCount(array);
            if count < 0 {
                return Err(MobileError::secure_storage(
                    "keychain returned an invalid item count",
                ));
            }
            let mut keys = Vec::new();
            for index in 0..count {
                let attributes = CFArrayGetValueAtIndex(array, index) as CFDictionaryRef;
                if attributes.is_null() {
                    return Err(MobileError::secure_storage(
                        "keychain returned empty item attributes",
                    ));
                }
                let account = CFDictionaryGetValue(attributes, kSecAttrAccount);
                if account.is_null() {
                    return Err(MobileError::secure_storage(
                        "keychain item is missing its account identifier",
                    ));
                }
                let account = cf_string_to_rust(account as CFStringRef)?;
                if !account.starts_with(prefix) {
                    continue;
                }
                let accessible = CFDictionaryGetValue(attributes, kSecAttrAccessible);
                if accessible.is_null()
                    || CFEqual(accessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly) == 0
                {
                    return Err(MobileError::secure_storage(
                        "keychain reliability record is not device-only",
                    ));
                }
                keys.push(account);
            }
            keys.sort();
            keys.dedup();
            Ok(keys)
        })();
        CFRelease(result);
        keys
    }
}

unsafe fn make_base_query(key: &str) -> MobileResult<CFMutableDictionaryRef> {
    let dictionary = make_service_query()?;
    let account = match cf_string(key) {
        Ok(account) => account,
        Err(error) => {
            CFRelease(dictionary);
            return Err(error);
        }
    };
    CFDictionarySetValue(dictionary, kSecAttrAccount, account);
    CFRelease(account);
    Ok(dictionary)
}

unsafe fn make_service_query() -> MobileResult<CFMutableDictionaryRef> {
    let dictionary = cf_dictionary();
    if dictionary.is_null() {
        return Err(MobileError::secure_storage(
            "keychain query dictionary allocation failed",
        ));
    }

    let service = match cf_string(SERVICE_NAME) {
        Ok(service) => service,
        Err(error) => {
            CFRelease(dictionary);
            return Err(error);
        }
    };
    CFDictionarySetValue(dictionary, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(dictionary, kSecAttrService, service);
    CFDictionarySetValue(dictionary, kSecAttrSynchronizable, kCFBooleanFalse);
    CFRelease(service);
    Ok(dictionary)
}

fn cf_string(value: &str) -> MobileResult<CFStringRef> {
    let bytes = value.as_bytes();
    let string = unsafe {
        CFStringCreateWithBytes(
            ptr::null(),
            bytes.as_ptr() as *const c_uchar,
            bytes.len() as c_long,
            K_CF_STRING_ENCODING_UTF8,
            0,
        )
    };
    if string.is_null() {
        Err(MobileError::secure_storage(
            "keychain string allocation failed",
        ))
    } else {
        Ok(string)
    }
}

unsafe fn cf_string_to_rust(value: CFStringRef) -> MobileResult<String> {
    let length = CFStringGetLength(value);
    if length < 0 {
        return Err(MobileError::secure_storage(
            "keychain account has an invalid string length",
        ));
    }
    let maximum = CFStringGetMaximumSizeForEncoding(length, K_CF_STRING_ENCODING_UTF8);
    if maximum < 0 {
        return Err(MobileError::secure_storage(
            "keychain account cannot be represented as UTF-8",
        ));
    }
    let mut buffer = vec![0i8; maximum as usize + 1];
    if CFStringGetCString(
        value,
        buffer.as_mut_ptr(),
        buffer.len() as c_long,
        K_CF_STRING_ENCODING_UTF8,
    ) == 0
    {
        return Err(MobileError::secure_storage(
            "keychain account UTF-8 conversion failed",
        ));
    }
    CStr::from_ptr(buffer.as_ptr())
        .to_str()
        .map(str::to_owned)
        .map_err(|error| {
            MobileError::secure_storage(format!("keychain account is not valid UTF-8: {error}"))
        })
}

unsafe fn cf_dictionary() -> CFMutableDictionaryRef {
    CFDictionaryCreateMutable(
        ptr::null(),
        0,
        &kCFTypeDictionaryKeyCallBacks as *const c_void,
        &kCFTypeDictionaryValueCallBacks as *const c_void,
    )
}

fn cf_data(bytes: &[u8]) -> MobileResult<CFDataRef> {
    let data = unsafe { CFDataCreate(ptr::null(), bytes.as_ptr(), bytes.len() as c_long) };
    if data.is_null() {
        Err(MobileError::secure_storage(
            "keychain data allocation failed",
        ))
    } else {
        Ok(data)
    }
}

fn status_error(operation: &str, status: OSStatus) -> MobileError {
    MobileError::secure_storage(format!(
        "keychain {operation} failed with OSStatus {status}"
    ))
}
