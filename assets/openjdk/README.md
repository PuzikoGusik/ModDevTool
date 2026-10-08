# Browser compiler assets

`../javac17.jar` contains the unchanged class files from the `jdk.compiler.jmod` module in Eclipse Temurin OpenJDK 17.0.20.1+1. The module descriptor was omitted so the compiler can load as a classpath library in CheerpJ. The platform-provider service descriptor in `services/` was added to replace the service declaration formerly supplied by that module descriptor. `javac17-sources.zip` contains the corresponding compiler sources.

Upstream binary distribution:
https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz

Upstream source distribution:
https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk-sources_17.0.20.1_1.tar.gz

The binary archive was verified against SHA-256 `3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e`. The source archive was verified against SHA-256 `21e2a065d244ab048e737f21af5d1fc74daaeb6707de36477ead8db1dca71214`.

`platforms.ct.sym` was derived from the platform signature archive in Eclipse Temurin OpenJDK 21.0.12.1+1, which includes API signatures for Java 17 as well as earlier releases. Only entries covering Java 8, 11, or 17 were retained. Their signature class-file major version was changed from 65 to 61 for the javac 17 reader; API declarations were not changed. These are API signatures, not executable platform classes, and do not provide Java 21 compilation. `scripts/adapt-platform-signatures.mjs` reproduces this adaptation from an original `ct.sym`. `platform-sources.zip` contains the corresponding upstream source files, recompressed without content changes.

Upstream platform distribution:
https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_linux_hotspot_21.0.12.1_1.tar.gz

These OpenJDK assets are covered by the supplied GPLv2 license with the Classpath Exception and additional licensing notices, not by the application's own copyright notice. Source archives and notices are published alongside the binary assets. The separately downloaded CheerpJ runtime is provided by Leaning Technologies under its own terms.
