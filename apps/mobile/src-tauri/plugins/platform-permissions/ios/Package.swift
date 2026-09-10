// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-peers-platform-permissions",
  platforms: [
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-peers-platform-permissions",
      type: .static,
      targets: ["tauri-plugin-peers-platform-permissions"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-peers-platform-permissions",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
