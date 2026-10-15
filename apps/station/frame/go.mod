module github.com/peers-labs/peers-touch/station/frame

go 1.24.6

toolchain go1.24.10

require (
	buf.build/gen/go/prometheus/prometheus/protocolbuffers/go v1.36.11-20260331160422-eae785f0a21d.1
	dario.cat/mergo v1.0.1
	git.sr.ht/~mariusor/go-xsd-duration v0.0.0-20220703122237-02e73435a078
	github.com/BurntSushi/toml v1.4.0
	github.com/bitly/go-simplejson v0.5.1
	github.com/cloudwego/hertz v0.9.5
	github.com/fsnotify/fsnotify v1.9.0
	github.com/ghodss/yaml v1.0.0
	github.com/go-ap/activitypub v0.0.0-20250212090640-aeb6499ba581
	github.com/go-ap/errors v0.0.0-20250124135319-3da8adefd4a9
	github.com/go-ap/jsonld v0.0.0-20221030091449-f2a191312c73
	github.com/go-log/log v0.2.0
	github.com/golang-jwt/jwt/v5 v5.3.0
	github.com/golang/protobuf v1.5.4
	github.com/golang/snappy v1.0.0
	github.com/google/uuid v1.6.0
	github.com/hashicorp/hcl v1.0.0
	github.com/konsorten/go-windows-terminal-sequences v1.0.3
	github.com/libp2p/go-libp2p v0.45.0
	github.com/minio/minio-go/v7 v7.0.74
	github.com/modern-go/reflect2 v1.0.2
	github.com/multiformats/go-multiaddr v0.16.1
	github.com/multiformats/go-multihash v0.2.3
	github.com/oklog/ulid/v2 v2.1.1
	github.com/oxtoacart/bpool v0.0.0-20190530202638-03653db5a59c
	github.com/prometheus/client_golang v1.23.2
	github.com/prometheus/client_model v0.6.2
	github.com/sasha-s/go-deadlock v0.3.6
	github.com/sirupsen/logrus v1.9.3
	github.com/sony/sonyflake v1.2.1
	github.com/stretchr/testify v1.11.1
	github.com/valyala/fastjson v1.6.4
	golang.org/x/crypto v0.47.0
	golang.org/x/sys v0.40.0
	google.golang.org/protobuf v1.36.11
	gopkg.in/urfave/cli.v1 v1.20.0
	gopkg.in/yaml.v2 v2.4.0
	gorm.io/driver/postgres v1.5.11
	gorm.io/driver/sqlite v1.6.0
	gorm.io/gorm v1.31.1
)

require (
	buf.build/gen/go/gogo/protobuf/protocolbuffers/go v1.36.11-20240617172848-e1dbca2775a7.1 // indirect
	github.com/benbjohnson/clock v1.3.5 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/bytedance/gopkg v0.1.0 // indirect
	github.com/bytedance/sonic v1.12.0 // indirect
	github.com/bytedance/sonic/loader v0.2.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/cloudwego/base64x v0.1.4 // indirect
	github.com/cloudwego/iasm v0.2.0 // indirect
	github.com/cloudwego/netpoll v0.6.4 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/davidlazar/go-crypto v0.0.0-20200604182044-b73af7476f6c // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.4.0 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/filecoin-project/go-clock v0.1.0 // indirect
	github.com/flynn/noise v1.1.0 // indirect
	github.com/francoispqt/gojay v1.2.13 // indirect
	github.com/go-ini/ini v1.67.0 // indirect
	github.com/goccy/go-json v0.10.3 // indirect
	github.com/gopherjs/gopherjs v0.0.0-20190430165422-3e4dfb77656c // indirect
	github.com/gorilla/websocket v1.5.4-0.20250319132907-e064f32e3674 // indirect
	github.com/huin/goupnp v1.3.0 // indirect
	github.com/ipfs/go-cid v0.6.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/pgx/v5 v5.7.2 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jackpal/go-nat-pmp v1.0.2 // indirect
	github.com/jbenet/go-temp-err-catcher v0.1.0 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/klauspost/compress v1.18.3 // indirect
	github.com/klauspost/cpuid/v2 v2.3.0 // indirect
	github.com/koron/go-ssdp v0.0.6 // indirect
	github.com/libp2p/go-buffer-pool v0.1.0 // indirect
	github.com/libp2p/go-flow-metrics v0.3.0 // indirect
	github.com/libp2p/go-libp2p-asn-util v0.4.1 // indirect
	github.com/libp2p/go-msgio v0.3.0 // indirect
	github.com/libp2p/go-netroute v0.3.0 // indirect
	github.com/libp2p/go-reuseport v0.4.0 // indirect
	github.com/libp2p/go-yamux/v5 v5.0.1 // indirect
	github.com/marten-seemann/tcp v0.0.0-20210406111302-dfbc87cc63fd // indirect
	github.com/mattn/go-sqlite3 v1.14.24 // indirect
	github.com/miekg/dns v1.1.68 // indirect
	github.com/mikioh/tcpinfo v0.0.0-20190314235526-30a79bb1804b // indirect
	github.com/mikioh/tcpopt v0.0.0-20190314235656-172688c1accc // indirect
	github.com/minio/md5-simd v1.1.2 // indirect
	github.com/minio/sha256-simd v1.0.1 // indirect
	github.com/mr-tron/base58 v1.2.0 // indirect
	github.com/multiformats/go-base32 v0.1.0 // indirect
	github.com/multiformats/go-base36 v0.2.0 // indirect
	github.com/multiformats/go-multiaddr-dns v0.4.1 // indirect
	github.com/multiformats/go-multiaddr-fmt v0.1.0 // indirect
	github.com/multiformats/go-multibase v0.2.0 // indirect
	github.com/multiformats/go-multicodec v0.10.0 // indirect
	github.com/multiformats/go-multistream v0.6.1 // indirect
	github.com/multiformats/go-varint v0.1.0 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/nyaruka/phonenumbers v1.6.5 // indirect
	github.com/pbnjay/memory v0.0.0-20210728143218-7b4eea64cf58 // indirect
	github.com/petermattis/goid v0.0.0-20250813065127-a731cc31b4fe // indirect
	github.com/pion/datachannel v1.6.0 // indirect
	github.com/pion/dtls/v2 v2.2.12 // indirect
	github.com/pion/dtls/v3 v3.0.10 // indirect
	github.com/pion/ice/v4 v4.2.0 // indirect
	github.com/pion/interceptor v0.1.43 // indirect
	github.com/pion/logging v0.2.4 // indirect
	github.com/pion/mdns/v2 v2.1.0 // indirect
	github.com/pion/randutil v0.1.0 // indirect
	github.com/pion/rtcp v1.2.16 // indirect
	github.com/pion/rtp v1.10.0 // indirect
	github.com/pion/sctp v1.9.2 // indirect
	github.com/pion/sdp/v3 v3.0.17 // indirect
	github.com/pion/srtp/v3 v3.0.10 // indirect
	github.com/pion/stun v0.6.1 // indirect
	github.com/pion/stun/v3 v3.1.1 // indirect
	github.com/pion/transport/v2 v2.2.10 // indirect
	github.com/pion/transport/v4 v4.0.1 // indirect
	github.com/pion/turn/v4 v4.1.4 // indirect
	github.com/pion/webrtc/v4 v4.2.3 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/prometheus/common v0.66.1 // indirect
	github.com/prometheus/procfs v0.17.0 // indirect
	github.com/quic-go/qpack v0.5.1 // indirect
	github.com/quic-go/quic-go v0.55.0 // indirect
	github.com/quic-go/webtransport-go v0.9.0 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/rs/xid v1.5.0 // indirect
	github.com/smartystreets/goconvey v1.7.2 // indirect
	github.com/spaolacci/murmur3 v1.1.0 // indirect
	github.com/tidwall/gjson v1.18.0 // indirect
	github.com/tidwall/match v1.1.1 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/twitchyliquid64/golang-asm v0.15.1 // indirect
	github.com/wlynxg/anet v0.0.5 // indirect
	go.uber.org/dig v1.19.0 // indirect
	go.uber.org/fx v1.24.0 // indirect
	go.uber.org/mock v0.5.2 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.1 // indirect
	go.yaml.in/yaml/v2 v2.4.3 // indirect
	golang.org/x/arch v0.0.0-20210923205945-b76863e36670 // indirect
	golang.org/x/exp v0.0.0-20260112195511-716be5621a96 // indirect
	golang.org/x/mod v0.32.0 // indirect
	golang.org/x/net v0.49.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/telemetry v0.0.0-20260109210033-bd525da824e2 // indirect
	golang.org/x/text v0.33.0 // indirect
	golang.org/x/time v0.14.0 // indirect
	golang.org/x/tools v0.41.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	lukechampine.com/blake3 v1.4.1 // indirect
)
