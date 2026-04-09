// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "PeersTouch",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "PeersTouch", targets: ["PeersTouch"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-protobuf.git", from: "1.28.0")
    ],
    targets: [
        .target(
            name: "PeersTouch",
            dependencies: [
                .product(name: "SwiftProtobuf", package: "swift-protobuf")
            ],
            path: "PeersTouch"
        )
    ]
)
