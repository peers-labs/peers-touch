package infrastructure

import (
	"encoding/hex"
	"testing"

	"github.com/cloudflare/circl/hpke"
	"github.com/stretchr/testify/require"
)

func TestCFRGRFC9180X25519ChaCha20Poly1305ReceiverVector(t *testing.T) {
	decode := func(value string) []byte {
		raw, err := hex.DecodeString(value)
		require.NoError(t, err)
		return raw
	}
	// Independent CFRG RFC 9180 published vector, mode=0/KEM=32/KDF=1/AEAD=3.
	// https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/master/test-vectors.json
	private := decode("8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb")
	enc := decode("1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a")
	info := decode("4f6465206f6e2061204772656369616e2055726e")
	aad := decode("436f756e742d30")
	ciphertext := decode("1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28")
	expected := decode("4265617574792069732074727574682c20747275746820626561757479")
	key, err := hpke.KEM_X25519_HKDF_SHA256.Scheme().UnmarshalBinaryPrivateKey(private)
	require.NoError(t, err)
	suite := hpke.NewSuite(hpke.KEM_X25519_HKDF_SHA256, hpke.KDF_HKDF_SHA256, hpke.AEAD_ChaCha20Poly1305)
	receiver, err := suite.NewReceiver(key, info)
	require.NoError(t, err)
	opener, err := receiver.Setup(enc)
	require.NoError(t, err)
	actual, err := opener.Open(ciphertext, aad)
	require.NoError(t, err)
	require.Equal(t, expected, actual)
}
