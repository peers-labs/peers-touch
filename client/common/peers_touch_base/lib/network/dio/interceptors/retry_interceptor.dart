import 'package:dio/dio.dart';
import 'package:dio_smart_retry/dio_smart_retry.dart';

RetryInterceptor createRetryInterceptor(Dio dio) {
  return RetryInterceptor(
    dio: dio,
    logPrint: print, // Use the default print function for logging
    retries: 2, // Reduced from 3 to avoid long waits
    retryDelays: const [
      Duration(milliseconds: 500),
      Duration(seconds: 1),
    ],
  );
}
