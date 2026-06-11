export default function createAppletBridge(_nativeModules, nativeModulesCall) {
  return {
    invoke(payload) {
      return nativeModulesCall('invoke', payload);
    },
    call(name, data, callback) {
      nativeModulesCall(name, data).then(callback);
    },
  };
}
