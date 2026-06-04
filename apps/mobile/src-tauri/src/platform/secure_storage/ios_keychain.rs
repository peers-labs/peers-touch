use std::ffi::c_void;
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
}

type CFTypeRef = *const c_void;
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
    static kCFBooleanTrue: CFTypeRef;

    fn CFDataCreate(allocator: CFTypeRef, bytes: *const u8, length: c_long) -> CFDataRef;
    fn CFDataGetBytePtr(data: CFDataRef) -> *const c_uchar;
    fn CFDataGetLength(data: CFDataRef) -> c_long;
    fn CFDictionaryCreateMutable(
        allocator: CFTypeRef,
        capacity: c_long,
        key_call_backs: *const c_void,
        value_call_backs: *const c_void,
    ) -> CFMutableDictionaryRef;
    fn CFDictionarySetValue(dictionary: CFMutableDictionaryRef, key: CFTypeRef, value: CFTypeRef);
    fn CFRelease(cf: CFTypeRef);
    fn CFStringCreateWithBytes(
        allocator: CFTypeRef,
        bytes: *const c_uchar,
        num_bytes: c_long,
        encoding: u32,
        is_external_representation: bool,
    ) -> CFStringRef;
}

#[link(name = "Security", kind = "framework")]
extern "C" {
    static kSecClass: CFTypeRef;
    static kSecClassGenericPassword: CFTypeRef;
    static kSecAttrAccount: CFTypeRef;
    static kSecAttrService: CFTypeRef;
    static kSecValueData: CFTypeRef;
    static kSecReturnData: CFTypeRef;
    static kSecMatchLimit: CFTypeRef;
    static kSecMatchLimitOne: CFTypeRef;

    fn SecItemAdd(attributes: CFMutableDictionaryRef, result: *mut CFTypeRef) -> OSStatus;
    fn SecItemCopyMatching(query: CFMutableDictionaryRef, result: *mut CFTypeRef) -> OSStatus;
    fn SecItemDelete(query: CFMutableDictionaryRef) -> OSStatus;
    fn SecItemUpdate(query: CFMutableDictionaryRef, attributes_to_update: CFMutableDictionaryRef) -> OSStatus;
}

fn keychain_set(key: &str, value: &str) -> MobileResult<()> {
    unsafe {
        let query = make_base_query(key)?;
        let value_data = cf_data(value.as_bytes())?;
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
            return Err(MobileError::secure_storage("keychain update dictionary allocation failed"));
        }
        let value_data = cf_data(value.as_bytes())?;
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
        let slice = std::slice::from_raw_parts(bytes, length as usize);
        let value = String::from_utf8(slice.to_vec())
            .map_err(|err| MobileError::secure_storage(format!("keychain value is not utf-8: {err}")))?;
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

unsafe fn make_base_query(key: &str) -> MobileResult<CFMutableDictionaryRef> {
    let dictionary = cf_dictionary();
    if dictionary.is_null() {
        return Err(MobileError::secure_storage("keychain query dictionary allocation failed"));
    }

    let service = cf_string(SERVICE_NAME)?;
    let account = cf_string(key)?;
    CFDictionarySetValue(dictionary, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(dictionary, kSecAttrService, service);
    CFDictionarySetValue(dictionary, kSecAttrAccount, account);
    CFRelease(service);
    CFRelease(account);
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
            false,
        )
    };
    if string.is_null() {
        Err(MobileError::secure_storage("keychain string allocation failed"))
    } else {
        Ok(string)
    }
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
        Err(MobileError::secure_storage("keychain data allocation failed"))
    } else {
        Ok(data)
    }
}

fn status_error(operation: &str, status: OSStatus) -> MobileError {
    MobileError::secure_storage(format!("keychain {operation} failed with OSStatus {status}"))
}
