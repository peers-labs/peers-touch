# 1. Problems

The peers_touch_base network module’s HttpServiceImpl casts `response.data` to generic `T` without a unified decoder when `fromJson` is not provided. This is risky and leads to inconsistent behavior across HTTP verbs.

## 1.1. **Unsafe Generic Casts**
- File: client/common/peers_touch_base/lib/network/dio/http_service_impl.dart
- Locations:
  - GET: lines 68–70
  - POST: lines 88–90
  - PUT: lines 108–110
  - DELETE: lines 128–130
  - PATCH: lines 148–150

Problem: `response.data as T` assumes Dio returns a value already matching `T`. In practice, Dio returns `Map<String, dynamic>`, `List<dynamic>`, or raw types depending on content-type and options.

Why this is problematic:
- Maintainability: Call sites rely on implicit casting instead of an explicit, testable decoding step.
- Stability: Mismatched `T` triggers runtime `TypeError` that are hard to catch at compile time.
- Inconsistency: Protobuf path uses `fromJson` (bytes -> proto), while JSON path relies on a blind cast.

Code example (current):
```dart
Future<T> get<T>(String path, {Map<String, dynamic>? queryParameters, ProtoFactory<T>? fromJson}) async {
  if (fromJson != null) {
    final response = await _dio.get<List<int>>(path, queryParameters: queryParameters);
    return fromJson(response.data!);
  }
  final response = await getResponse<T>(path, queryParameters: queryParameters);
  return response.data as T; // brittle
}
```

## 1.2. **No Unified JSON Decoding Contract**
- Scope: All verb methods when `fromJson == null`.

Problem: There is no contract for decoding JSON responses into domain models. Each caller must know whether `T` should be a raw `Map`/`List` or a concrete model, which causes confusion.

Why this matters:
- Readability: It’s not clear how a `T` is populated. Developers need to trace Dio defaults.
- Extensibility: Adding new endpoints with typed models requires ad-hoc decoding at each call site.

# 2. Benefits

The refactor provides a single, explicit decoding path for JSON and protobuf, reducing runtime risks and aligning behavior across HTTP verbs.

## 2.1. **Reduced Runtime Errors**
- Replacing blind casts with a decoder removes hidden `TypeError` risks.
- Estimated reduction in casting-related failures by moving checks into a single decoder.

## 2.2. **Improved Testability**
- A single decoder can be unit-tested. Callers stop duplicating decode logic.
- Cyclomatic complexity per verb is expected to reduce from **2** branches to **1** unified path.

## 2.3. **Enhanced Consistency Across Verbs**
- GET/POST/PUT/DELETE/PATCH all follow the same decoding contract.
- Error handling stays centralized in interceptors and the decoder.

# 3. Solutions

Introduce a unified typed decoding adapter and a single private helper to route requests through this adapter. Deprecate direct casting.

## 3.1. **Unified Decoder + Helper**

Solution overview:
- Require either a `fromJson` (for protobuf bytes) or a `mapper` for JSON (`Map<String, dynamic>`/`List<dynamic>` -> `T`).
- Provide a private `_request<T>` that handles both proto and JSON while returning `T` safely.

Implementation steps:
- Add a `JsonMapper<T>` typedef: `typedef JsonMapper<T> = T Function(dynamic raw);`.
- Implement `_decode<T>(dynamic raw, {ProtoFactory<T>? fromJson, JsonMapper<T>? mapper})`.
- Implement `_request<T>(...)` to perform the Dio call and invoke `_decode`.
- Update verb methods to call `_request` and remove `as T` casts.

Before (representative):
```dart
final response = await postResponse<T>(path, data: data, queryParameters: queryParameters);
return response.data as T; // unsafe
```

After (proposed):
```dart
typedef JsonMapper<T> = T Function(dynamic raw);

Future<T> _request<T>(
  Future<Response<dynamic>> Function() call, {
  ProtoFactory<T>? fromJson,
  JsonMapper<T>? mapper,
}) async {
  final response = await call();
  return _decode<T>(response.data, fromJson: fromJson, mapper: mapper);
}

T _decode<T>(
  dynamic raw, {
  ProtoFactory<T>? fromJson,
  JsonMapper<T>? mapper,
}) {
  if (fromJson != null) {
    // Expect bytes for protobuf. If not bytes, throw to surface mismatch early.
    if (raw is! List<int>) {
      throw StateError('Expected protobuf bytes but got ${raw.runtimeType}');
    }
    return fromJson(raw);
  }
  if (mapper != null) {
    return mapper(raw);
  }
  // Fallback: return raw if already T; otherwise fail fast.
  if (raw is T) return raw;
  throw StateError('No mapper provided and raw is ${raw.runtimeType}, not $T');
}

Future<T> post<T>(String path, {dynamic data, Map<String, dynamic>? queryParameters, ProtoFactory<T>? fromJson, JsonMapper<T>? mapper}) async {
  return _request<T>(
    () => _dio.post<dynamic>(path, data: data, queryParameters: queryParameters),
    fromJson: fromJson,
    mapper: mapper,
  );
}
```

Notes:
- Callers of JSON endpoints pass a `mapper` (e.g., `(raw) => MyModel.fromJson(raw as Map<String, dynamic>)`).
- Proto endpoints keep passing `fromJson`.
- The fallback throws early, making type mismatches visible in tests.

## 3.2. **Optional: Register Mappers per Endpoint**

If many endpoints are used repeatedly, introduce a lightweight registry (map of path -> mapper) to avoid passing mappers everywhere. Keep API backward-compatible by supporting both explicit mapper and registry lookup.

Trade-offs:
- Registry adds indirection; prefer explicit mapper in library API, registry for app-level wiring.

# 4. Regression testing scope

End-to-end scope: Verify all network calls in modules that consume HttpServiceImpl behave consistently for JSON and protobuf, without runtime casts.

## 4.1. Main Scenarios
- Discovery feature: fetching discovery items list via GET JSON endpoint using a mapper.
  - Preconditions: Logged-in user, valid baseUrl.
  - Steps: Call repository; ensure models decode via mapper.
  - Expected: Proper model instances; no cast errors.
- AI provider service: POST/GET to provider APIs; protobuf endpoints still decode with `fromJson`.
  - Preconditions: Provider configured.
  - Steps: Invoke provider queries; verify bytes -> proto path.
  - Expected: Correct proto objects; consistent error handling.

## 4.2. Edge Cases
- Non-JSON responses: Ensure mapper is not used; fallback throws early if `T` mismatches.
- Empty body / 204 No Content: Verify decoding returns `void`/`Null` or throws a controlled error depending on API contract.
- Content-type mismatch: If server sends JSON but client expects proto (or vice versa), confirm early failure with clear message.
