import { sdk } from '@peers-touch/applet-sdk';

export async function requestAtelierService(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  query?: Record<string, string | number | boolean>,
) {
  return sdk.network.request({
    service: 'atelier',
    method,
    path,
    query,
    body,
  });
}
