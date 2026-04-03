# 1. Problems

HttpServiceImpl duplicates request logic across HTTP verbs and lacks a single unified request helper. Only GET explicitly sets JSON options, while other verbs rely on defaults. This causes inconsistent behavior and makes future changes risky and tedious.

## 1.1. **Excessive Duplication Across Verbs**
- File: client/common/peers_touch_base/lib/network/dio/http_service_impl.dart
- Locations:
    - get<T> (lines 55–78)
    - post<T> (lines 81–98)
    - put<T> (lines 101–118)
    - delete<T> (lines 121–138)
    - patch<T> (lines 141–158)
- Each verb replicates the same two-branch pattern: a protobuf branch (`fromJson != null` using `List<int>`) and a JSON branch that returns `response.data as T`.
- Changes to shared behavior (e.g., headers, responseType, request options, tracing, cancellation) must be repeated in 5 places.

Example before (GET vs POST):

```dart
// GET: sets Accept + ResponseType.json
afinal response = await _dio.get<T>(
  path,
  queryParameters: queryParameters,
  options: Options(
    headers: {'Accept': 'application/json'},
    responseType: ResponseType.json,
  ),
);
return response.data as T;

// POST: no explicit JSON options
final response = await postResponse<T>(path, data: data, queryParameters: queryParameters);
return response.data as T;
```

## 1.2. **Inconsistent JSON Options Across Verbs**
- Only `get<T>` sets `Accept: application/json` and `ResponseType.json`.
- `post/put/delete/patch` do not, relying on server defaults and Dio heuristics.
- This can produce different decoding behavior across verbs. A server that requires explicit `Accept` may return non-JSON or different content negotiation results for non-GET requests.
- Blind `as T` casts hide decoding uncertainty until runtime.

## 1.3. **Hard to Add Cross-Cutting Behavior**
- Adding cancellation tokens, trace IDs, or per-request retries consistently would require touching 10 methods (both `T` and `Response<T>` variants).
- This increases the chance of mistakes and inconsistency.

# 2. Benefits

A unified request helper will standardize JSON handling and reduce duplication, making the HTTP layer easier to change safely.

## 2.1. **Reduced Complexity**
- Consolidate 10 public methods’ duplicated internals into 1–2 private helpers.
- Estimated cyclomatic complexity for verb methods drops from around **12** to **4**, and future option changes touch **1** place.

## 2.2. **Consistent Behavior Across Verbs**
- Always send `Accept: application/json` and use `ResponseType.json` for JSON paths.
- Protobuf branches stay consistent across verbs.

## 2.3. **Improved Testability**
- One helper is straightforward to unit test (JSON vs proto branches, header presence, responseType).
- Fewer code paths reduce the probability of subtle differences.

# 3. Solutions

Introduce a single private helper that handles both proto and JSON paths and is called by all verb methods. Standardize JSON options across verbs.

## 3.1. **Unified Request Helper**

### Solution overview
- Implement `_request<T>` and `_requestResponse<T>` that accept the HTTP method, path, data, query, and optional `fromJson`.
- For proto (`fromJson != null`), request `List<int>` and apply the provided decoder.
- For JSON, set `Accept: application/json` and `ResponseType.json` consistently.

### Implementation steps
- Add `_request<T>(...)` and `_requestResponse<T>(...)` using `_dio.request` with `Options(method: ...)`.
- Refactor `get/post/put/delete/patch` to call the helper.
- Keep public API unchanged.

### Code example before

```dart
// get<T>
if (fromJson != null) {
  final response = await _dio.get<List<int>>(path, queryParameters: queryParameters);
  return fromJson(response.data!);
}
final response = await _dio.get<T>(
  path,
  queryParameters: queryParameters,
  options: Options(
    headers: {'Accept': 'application/json'},
    responseType: ResponseType.json,
  ),
);
return response.data as T;

// post<T>
if (fromJson != null) {
  final response = await _dio.post<List<int>>(path, data: data, queryParameters: queryParameters);
  return fromJson(response.data!);
}
final response = await postResponse<T>(path, data: data, queryParameters: queryParameters);
return response.data as T;
```

### Code example after

```dart
Future<T> _request<T>(
  String method,
  String path, {
  dynamic data,
  Map<String, dynamic>? queryParameters,
  ProtoFactory<T>? fromJson,
}) async {
  if (fromJson != null) {
    final response = await _dio.request<List<int>>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: Options(method: method),
    );
    return fromJson(response.data!);
  }
  final response = await _dio.request<T>(
    path,
    data: data,
    queryParameters: queryParameters,
    options: Options(
      method: method,
      headers: {'Accept': 'application/json'},
      responseType: ResponseType.json,
    ),
  );
  return response.data as T;
}

Future<Response<T>> _requestResponse<T>(
  String method,
  String path, {
  dynamic data,
  Map<String, dynamic>? queryParameters,
}) async {
  return _dio.request<T>(
    path,
    data: data,
    queryParameters: queryParameters,
    options: Options(method: method),
  );
}

// Public methods remain thin wrappers
Future<T> get<T>(String path, {Map<String, dynamic>? queryParameters, ProtoFactory<T>? fromJson}) =>
    _request<T>('GET', path, queryParameters: queryParameters, fromJson: fromJson);
Future<T> post<T>(String path, {dynamic data, Map<String, dynamic>? queryParameters, ProtoFactory<T>? fromJson}) =>
    _request<T>('POST', path, data: data, queryParameters: queryParameters, fromJson: fromJson);
// ... put/delete/patch similar
```

### Notes
- If desired, you can also set default headers at `BaseOptions.headers` to include `Accept: application/json`, but keeping it explicit in the JSON branch of the helper makes intent clear and avoids affecting proto paths.
- Keep interceptors order unchanged; this change does not affect them.

## 3.2. **Optional: Centralize Common Options**
- As a follow-up, consider adding optional parameters to the helper (e.g., `CancelToken`, custom headers) to standardize cross-cutting concerns without touching each verb.

# 4. Regression testing scope

This change affects the HTTP layer used by desktop client modules (discovery, profile, ai_chat) and any feature that calls `IHttpService`.

## 4.1. Main Scenarios
- JSON responses on all verbs:
    - GET profile details
    - POST update profile
    - PUT follow/unfollow
    - DELETE content item
    - PATCH partial update
  Validate that:
    - `Accept: application/json` is present for JSON paths.
    - JSON decoding behavior is consistent across verbs.
- Protobuf responses on all verbs:
    - Ensure `fromJson` branch still decodes correctly for each verb.

## 4.2. Edge Cases
- Server requires explicit `Accept` header for POST/PUT/DELETE: verify content negotiation returns JSON.
- Non-JSON responses: confirm JSON branch handles errors via existing interceptors.
- Retry and error interceptors: ensure behavior unchanged (helper should not swallow exceptions).
- Large payloads / binary endpoints: confirm proto branch still uses `List<int>` and does not inherit JSON options.
