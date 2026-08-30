buildscript {
    configurations.classpath {
        resolutionStrategy.activateDependencyLocking()
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.5.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    dependencyLocking {
        val projectLockName = project.path
            .removePrefix(":")
            .replace(":", "-")
            .ifEmpty { "root" }
        lockFile = rootProject.file("gradle/dependency-locks/$projectLockName.lockfile")
        lockAllConfigurations()
    }
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}
