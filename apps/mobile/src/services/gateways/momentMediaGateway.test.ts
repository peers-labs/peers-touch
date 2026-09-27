// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { create } from '@bufbuild/protobuf';
import {
  encryptClientMediaBlobChunked,
} from '@peers-touch/client-media-security';
import { describe, expect, it, vi } from 'vitest';

import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import { ImageAttachmentSchema } from '../../gen/proto/domain/social/post_pb';
import {
  createMomentMediaGateway,
  resolveMomentMediaSource,
} from './momentMediaGateway';

const executeStationOperation = vi.hoisted(() => vi.fn());

vi.mock('../stationTransport', () => ({
  executeStationOperation,
  responseArrayBuffer: (response: { bodyBytes: number[] }) =>
    Uint8Array.from(response.bodyBytes).buffer,
}));

const session = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('Moment media gateway', () => {
  it('resolves a local OSS CID through the authenticated Station endpoint', () => {
    expect(resolveMomentMediaSource(
      'oss://https://station.example/cas/aa/image',
      session.stationUrl,
    )).toEqual({
      url: 'https://station.example/sub-oss/file?key=cas%2Faa%2Fimage',
      authenticated: true,
    });
  });

  it('does not disclose the home Station token to a foreign public object', async () => {
    const fetcher = vi.fn(async () => new Response(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      { status: 200 },
    ));
    const gateway = createMomentMediaGateway(session, fetcher);

    await gateway.loadImage(create(ImageAttachmentSchema, {
      id: 'oss://https://remote.example/cas/remote/image',
      url: 'oss://https://remote.example/cas/remote/image',
    }));

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://remote.example/sub-oss/file?key=cas%2Fremote%2Fimage',
    );
    expect(fetcher.mock.calls[0][1].headers).toEqual({
      Accept: 'application/octet-stream',
    });
  });

  it('decrypts and verifies ciphertext with the shared media-security owner', async () => {
    const plaintext = new TextEncoder().encode('verified moment image');
    const encrypted = await encryptClientMediaBlobChunked(
      new Blob([plaintext], { type: 'image/png' }),
      { chunkSize: 8 },
    );
    const fetcher = vi.fn(async () => new Response(encrypted.encryptedBlob, {
      status: 200,
    }));
    executeStationOperation.mockResolvedValueOnce({
      status: 200,
      contentType: 'application/octet-stream',
      bodyBytes: Array.from(new Uint8Array(await encrypted.encryptedBlob.arrayBuffer())),
    });
    const gateway = createMomentMediaGateway(session, fetcher);

    const result = await gateway.loadImage(create(ImageAttachmentSchema, {
      id: 'oss://https://station.example/cas/verified/image',
      url: 'oss://https://station.example/cas/verified/image',
      mediaEncryption: create(EncryptedMediaDescriptorSchema, {
        ...encrypted.descriptor,
        plaintextSize: BigInt(encrypted.descriptor.plaintextSize),
        ciphertextSize: BigInt(encrypted.descriptor.ciphertextSize),
      }),
    }));

    expect(new Uint8Array(await result.arrayBuffer())).toEqual(plaintext);
    expect(executeStationOperation).toHaveBeenCalledWith(
      session,
      { operationId: 'oss_download', key: 'cas/verified/image' },
      undefined,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects tampered ciphertext instead of returning renderable bytes', async () => {
    const encrypted = await encryptClientMediaBlobChunked(
      new Blob([new TextEncoder().encode('untampered')]),
      { chunkSize: 8 },
    );
    const tampered = new Uint8Array(await encrypted.encryptedBlob.arrayBuffer());
    tampered[0] ^= 0xff;
    executeStationOperation.mockResolvedValueOnce({
      status: 200,
      contentType: 'application/octet-stream',
      bodyBytes: Array.from(tampered),
    });
    const gateway = createMomentMediaGateway(
      session,
      vi.fn(),
    );

    await expect(gateway.loadImage(create(ImageAttachmentSchema, {
      id: 'oss://https://station.example/cas/tampered/image',
      url: 'oss://https://station.example/cas/tampered/image',
      mediaEncryption: create(EncryptedMediaDescriptorSchema, {
        ...encrypted.descriptor,
        plaintextSize: BigInt(encrypted.descriptor.plaintextSize),
        ciphertextSize: BigInt(encrypted.descriptor.ciphertextSize),
      }),
    }))).rejects.toThrow('client-media:ciphertext-hash-mismatch');
  });
});
