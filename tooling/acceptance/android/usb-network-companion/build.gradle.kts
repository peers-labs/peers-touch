plugins {
    id("com.android.application") version "8.5.1"
}

val peersTouchBuildDir = providers.gradleProperty("peersTouchBuildDir").orNull
    ?: error("peersTouchBuildDir is required")
layout.buildDirectory.set(file(peersTouchBuildDir))

android {
    namespace = "com.peers.touch.acceptance.usbnetwork"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.peers.touch.acceptance.usbnetwork"
        minSdk = 24
        targetSdk = 29
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        getByName("debug") {
            isDebuggable = true
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
