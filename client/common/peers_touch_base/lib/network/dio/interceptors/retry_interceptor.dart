import 'package:dio/dio.dart';
import 'package:dio_smart_retry/dio_smart_retry.dart';

RetryInterceptor createRetryInterceptor(Dio dio) {
  return RetryInterceptor(
    dio: dio,
    logPrint: print, // Use the default print function for logging
    retries: 3, // Number of retries
    retryDelays: const [
      Duration(seconds: 1),
      Duration(seconds: 3),
      Duration(seconds: 5),
    ],
  );
}
