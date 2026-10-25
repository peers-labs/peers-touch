import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DevctlError, ERROR_CODES } from './errors.mjs';
import { loadFlavorRegistry, resolveDistribution } from '../distribution/flavors.mjs';

// Local desktop installs are the registered `dev` flavor. XCFG-D05 keeps this
// the single derivation point; PT_DESKTOP_APP_ID remains an override hatch.
const DEV_IDENTITY = resolveDistribution(loadFlavorRegistry(), {
  product: 'desktop',
  flavor: 'dev',
});
const DEFAULT_APP_ID = DEV_IDENTITY.identifier;
const PRODUCT_NAME = DEV_IDENTITY.displayName;
const DEEP_LINK_SCHEME = DEV_IDENTITY.deepLinkScheme;

const LINUX_PKG_CONFIG_REQUIREMENTS = [
  {
    module: 'glib-2.0',
    packages: ['Debian/Ubuntu: libglib2.0-dev', 'Fedora: glib2-devel'],
  },
  {
    module: 'gobject-2.0',
    packages: ['Debian/Ubuntu: libglib2.0-dev', 'Fedora: glib2-devel'],
  },
  {
    module: 'gio-2.0',
    packages: ['Debian/Ubuntu: libglib2.0-dev', 'Fedora: glib2-devel'],
  },
  {
    module: 'gtk+-3.0',
    packages: ['Debian/Ubuntu: libgtk-3-dev', 'Fedora: gtk3-devel'],
  },
  {
    module: 'webkit2gtk-4.1',
    packages: [
      'Debian/Ubuntu: libwebkit2gtk-4.1-dev',
      'Fedora: webkit2gtk4.1-devel',
    ],
  },
  {
    module: 'javascriptcoregtk-4.1',
    packages: [
      'Debian/Ubuntu: libjavascriptcoregtk-4.1-dev',
      'Fedora: javascriptcoregtk4.1-devel',
    ],
  },
  {
    module: 'libsoup-3.0',
    packages: ['Debian/Ubuntu: libsoup-3.0-dev', 'Fedora: libsoup3-devel'],
  },
  {
    module: 'librsvg-2.0',
    packages: ['Debian/Ubuntu: librsvg2-dev', 'Fedora: librsvg2-devel'],
  },
];

function validateAppId(environment) {
  const appId = (environment.PT_DESKTOP_APP_ID ?? DEFAULT_APP_ID).trim();
  const segments = appId.split('.');
  if (
    appId.length > 255
    || segments.length < 2
    || !segments.every((segment) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(segment),
    )
  ) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `Invalid Desktop application identifier: ${appId || '<empty>'}`,
      { appId },
    );
  }
  return appId;
}

function macOSInstallSettings(environment, homeDirectory) {
  const appId = validateAppId(environment);
  const installDirectory = path.posix.resolve(
    environment.PT_DESKTOP_INSTALL_DIR?.trim()
      || path.posix.join(homeDirectory, 'Applications'),
  );
  return {
    platform: 'darwin',
    appId,
    productName: PRODUCT_NAME,
    deepLinkScheme: DEEP_LINK_SCHEME,
    installDirectory,
    installPath: path.posix.join(installDirectory, `${PRODUCT_NAME}.app`),
  };
}

function linuxInstallSettings(environment, homeDirectory) {
  const appId = validateAppId(environment);
  const dataHome = path.posix.resolve(
    environment.XDG_DATA_HOME?.trim()
      || path.posix.join(homeDirectory, '.local', 'share'),
  );
  const installDirectory = path.posix.resolve(
    environment.PT_DESKTOP_INSTALL_DIR?.trim()
      || path.posix.join(dataHome, 'peers-touch', 'apps'),
  );
  const binDirectory = path.posix.resolve(
    environment.PT_DESKTOP_INSTALL_BIN_DIR?.trim()
      || path.posix.join(homeDirectory, '.local', 'bin'),
  );
  const desktopFileName = `${appId}.desktop`;
  return {
    platform: 'linux',
    appId,
    productName: PRODUCT_NAME,
    deepLinkScheme: DEEP_LINK_SCHEME,
    dataHome,
    installDirectory,
    installPath: path.posix.join(installDirectory, 'peers-dev.AppImage'),
    sourceReceiptPath: path.posix.join(
      installDirectory,
      'peers-dev.source.json',
    ),
    binDirectory,
    launcherPath: path.posix.join(binDirectory, 'peers-dev'),
    desktopEntryPath: path.posix.join(
      dataHome,
      'applications',
      desktopFileName,
    ),
    desktopFileName,
    iconPath: path.posix.join(
      dataHome,
      'icons',
      'hicolor',
      '256x256',
      'apps',
      `${appId}.png`,
    ),
  };
}

export function desktopInstallSettings(
  environment = process.env,
  homeDirectory = os.homedir(),
) {
  const { platform: _platform, ...settings } = macOSInstallSettings(
    environment,
    homeDirectory,
  );
  return settings;
}

export function desktopInstallSettingsForPlatform(
  platform,
  environment = process.env,
  homeDirectory = environment.HOME || os.homedir(),
) {
  if (platform === 'darwin') {
    return macOSInstallSettings(environment, homeDirectory);
  }
  if (platform === 'linux') {
    return linuxInstallSettings(environment, homeDirectory);
  }
  throw new DevctlError(
    ERROR_CODES.UNSUPPORTED_MODE,
    `Desktop installation is unavailable on ${platform}`,
    { platform, supportedPlatforms: ['darwin', 'linux'] },
  );
}

export function desktopInstallTauriConfig(settings) {
  return {
    productName: settings.productName,
    identifier: settings.appId,
    plugins: {
      'deep-link': {
        desktop: {
          schemes: [settings.deepLinkScheme],
        },
      },
    },
  };
}

export function desktopInstallTauriArguments(
  configPath,
  bundle = 'app',
  environment = process.env,
) {
  const args = ['build', '--bundles', bundle];
  if (environment.PT_DESKTOP_E2E === 'true') {
    args.push('--features', 'e2e-testing');
  }
  args.push('--config', configPath);
  return args;
}

export function signDesktopApplication(
  appPath,
  runCommand = spawnSync,
  codesign = '/usr/bin/codesign',
) {
  if (!fs.existsSync(codesign)) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'codesign is required to install Desktop on macOS',
      { codesign },
    );
  }
  const signResult = runCommand(
    codesign,
    ['--force', '--deep', '--sign', '-', appPath],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (signResult.error || signResult.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `Unable to sign Desktop application at ${appPath}`,
      {
        status: signResult.status,
        cause: signResult.error?.message,
        stderr: signResult.stderr?.trim(),
      },
    );
  }
  const verifyResult = runCommand(
    codesign,
    ['--verify', '--deep', '--strict', appPath],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (verifyResult.error || verifyResult.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `Desktop application signature is invalid at ${appPath}`,
      {
        status: verifyResult.status,
        cause: verifyResult.error?.message,
        stderr: verifyResult.stderr?.trim(),
      },
    );
  }
  return { signed: true, appPath };
}

export function replaceDesktopApplication(
  sourcePath,
  installPath,
  prepareStaging = () => {},
) {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `Built Desktop application is unavailable: ${sourcePath}`,
      { sourcePath },
    );
  }

  const installDirectory = path.dirname(installPath);
  const stagingPath = `${installPath}.installing-${process.pid}`;
  const backupPath = `${installPath}.previous-${process.pid}`;
  fs.mkdirSync(installDirectory, { recursive: true });
  fs.rmSync(stagingPath, { recursive: true, force: true });
  fs.rmSync(backupPath, { recursive: true, force: true });

  try {
    fs.cpSync(sourcePath, stagingPath, {
      recursive: true,
      preserveTimestamps: true,
    });
    prepareStaging(stagingPath);
    if (fs.existsSync(installPath)) {
      fs.renameSync(installPath, backupPath);
    }
    fs.renameSync(stagingPath, installPath);
    fs.rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(stagingPath, { recursive: true, force: true });
    if (!fs.existsSync(installPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, installPath);
    }
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `Unable to install Desktop application at ${installPath}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  return installPath;
}

function fsyncPath(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directory) {
  try {
    fsyncPath(directory);
  } catch (error) {
    const unsupportedOnWindows =
      process.platform === 'win32' && error?.code === 'EPERM';
    if (!unsupportedOnWindows && !['EINVAL', 'ENOTSUP'].includes(error?.code)) {
      throw error;
    }
  }
}

function writeStagedFile(stagingPath, entry) {
  if (entry.sourcePath) {
    fs.copyFileSync(entry.sourcePath, stagingPath);
  } else {
    fs.writeFileSync(stagingPath, entry.content);
  }
  fs.chmodSync(stagingPath, entry.mode);
  fsyncPath(stagingPath);
}

export function atomicReplaceDesktopFiles(entries, verify = () => {}) {
  const transaction = entries.map((entry, index) => ({
    ...entry,
    stagingPath: `${entry.targetPath}.installing-${process.pid}-${index}`,
    backupPath: `${entry.targetPath}.previous-${process.pid}-${index}`,
    hadPrevious: false,
    installed: false,
  }));

  try {
    for (const entry of transaction) {
      const directory = path.dirname(entry.targetPath);
      fs.mkdirSync(directory, { recursive: true });
      fs.rmSync(entry.stagingPath, { force: true });
      fs.rmSync(entry.backupPath, { force: true });
      writeStagedFile(entry.stagingPath, entry);
      fsyncDirectory(directory);
    }

    for (const entry of transaction) {
      const directory = path.dirname(entry.targetPath);
      entry.hadPrevious = fs.existsSync(entry.targetPath);
      if (entry.hadPrevious) {
        fs.renameSync(entry.targetPath, entry.backupPath);
        fsyncDirectory(directory);
      }
      fs.renameSync(entry.stagingPath, entry.targetPath);
      entry.installed = true;
      fsyncDirectory(directory);
    }

    verify();

    for (const entry of transaction) {
      if (fs.existsSync(entry.backupPath)) {
        fs.rmSync(entry.backupPath, { force: true });
        fsyncDirectory(path.dirname(entry.targetPath));
      }
    }
  } catch (error) {
    for (const entry of [...transaction].reverse()) {
      const directory = path.dirname(entry.targetPath);
      fs.rmSync(entry.stagingPath, { force: true });
      if (entry.installed) {
        fs.rmSync(entry.targetPath, { force: true });
      }
      if (fs.existsSync(entry.backupPath)) {
        fs.renameSync(entry.backupPath, entry.targetPath);
      }
      if (fs.existsSync(directory)) {
        fsyncDirectory(directory);
      }
    }
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      'Unable to atomically install Linux Desktop files',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  return entries.map(({ targetPath }) => targetPath);
}

function quotePosixShell(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function quoteDesktopExec(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`')}"`;
}

export function linuxDesktopLauncher(settings) {
  return [
    '#!/bin/sh',
    `exec ${quotePosixShell(settings.installPath)} "$@"`,
    '',
  ].join('\n');
}

export function linuxDesktopEntry(settings, sourceCommit) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${settings.productName}`,
    `Comment=Peers Touch development Desktop (${sourceCommit.slice(0, 12)})`,
    `Exec=${quoteDesktopExec(settings.launcherPath)} %U`,
    `Icon=${settings.appId}`,
    'Terminal=false',
    'Categories=Network;Utility;',
    `MimeType=x-scheme-handler/${settings.deepLinkScheme};`,
    `StartupWMClass=${settings.productName}`,
    `X-Peers-Touch-Source-Commit=${sourceCommit}`,
    '',
  ].join('\n');
}

export function assertLinuxDesktopDependencies(
  environment,
  findProgram,
  runCommand = spawnSync,
) {
  const pkgConfig = findProgram('pkg-config', environment);
  const xdgMime = findProgram('xdg-mime', environment);
  const missingPrograms = [
    ...(!pkgConfig ? ['pkg-config'] : []),
    ...(!xdgMime ? ['xdg-mime'] : []),
  ];
  const missingModules = [];
  if (pkgConfig) {
    for (const requirement of LINUX_PKG_CONFIG_REQUIREMENTS) {
      const result = runCommand(pkgConfig, ['--exists', requirement.module], {
        env: environment,
        encoding: 'utf8',
        windowsHide: true,
      });
      if (result.error || result.status !== 0) {
        missingModules.push(requirement);
      }
    }
  }
  if (missingPrograms.length > 0 || missingModules.length > 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'Linux Desktop build prerequisites are missing; install them outside devctl and rerun',
      {
        platform: 'linux',
        missingPrograms,
        missingModules,
      },
    );
  }
  return { pkgConfig, xdgMime, missingPrograms: [], missingModules: [] };
}

function resolveLinuxAppImage(root) {
  const bundleDirectory = path.join(
    root,
    'apps',
    'desktop',
    'src-tauri',
    'target',
    'release',
    'bundle',
    'appimage',
  );
  const candidates = fs.existsSync(bundleDirectory)
    ? fs.readdirSync(bundleDirectory)
      .filter((entry) => entry.endsWith('.AppImage'))
      .map((entry) => path.join(bundleDirectory, entry))
      .filter((entry) => fs.statSync(entry).isFile())
    : [];
  if (candidates.length !== 1) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      'Desktop AppImage build produced an unexpected artifact set',
      { bundleDirectory, candidates },
    );
  }
  return candidates[0];
}

function cleanLinuxAppImages(root) {
  const bundleDirectory = path.join(
    root,
    'apps',
    'desktop',
    'src-tauri',
    'target',
    'release',
    'bundle',
    'appimage',
  );
  if (!fs.existsSync(bundleDirectory)) return;
  for (const entry of fs.readdirSync(bundleDirectory)) {
    if (entry.endsWith('.AppImage')) {
      fs.rmSync(path.join(bundleDirectory, entry), { force: true });
    }
  }
}

function installLinuxDesktop({
  environment,
  findProgram,
  iconSourcePath,
  runCommand,
  settings,
  sourceCommit,
  sourcePath,
}) {
  const xdgMime = findProgram('xdg-mime', environment);
  const previousAssociation = runCommand(
    xdgMime,
    ['query', 'default', `x-scheme-handler/${settings.deepLinkScheme}`],
    { env: environment, encoding: 'utf8', windowsHide: true },
  ).stdout?.trim() ?? '';

  const entries = [
    {
      sourcePath,
      targetPath: settings.installPath,
      mode: 0o755,
    },
    {
      content: `${JSON.stringify({
        kind: 'peers-touch-installed-desktop',
        platform: 'linux',
        sourceCommit,
        artifact: settings.installPath,
      }, null, 2)}\n`,
      targetPath: settings.sourceReceiptPath,
      mode: 0o644,
    },
    {
      content: linuxDesktopLauncher(settings),
      targetPath: settings.launcherPath,
      mode: 0o755,
    },
    {
      content: linuxDesktopEntry(settings, sourceCommit),
      targetPath: settings.desktopEntryPath,
      mode: 0o644,
    },
    {
      sourcePath: iconSourcePath,
      targetPath: settings.iconPath,
      mode: 0o644,
    },
  ];

  try {
    atomicReplaceDesktopFiles(entries, () => {
      const registration = runCommand(
        xdgMime,
        [
          'default',
          settings.desktopFileName,
          `x-scheme-handler/${settings.deepLinkScheme}`,
        ],
        { env: environment, encoding: 'utf8', windowsHide: true },
      );
      if (registration.error || registration.status !== 0) {
        throw new Error(
          registration.error?.message
          || registration.stderr?.trim()
          || 'xdg-mime registration failed',
        );
      }
      const query = runCommand(
        xdgMime,
        ['query', 'default', `x-scheme-handler/${settings.deepLinkScheme}`],
        { env: environment, encoding: 'utf8', windowsHide: true },
      );
      if (
        query.error
        || query.status !== 0
        || query.stdout?.trim() !== settings.desktopFileName
      ) {
        throw new Error('xdg-mime did not read back the installed protocol handler');
      }
      for (const executable of [settings.installPath, settings.launcherPath]) {
        fs.accessSync(executable, fs.constants.X_OK);
      }
      const receipt = JSON.parse(
        fs.readFileSync(settings.sourceReceiptPath, 'utf8'),
      );
      if (receipt.sourceCommit !== sourceCommit) {
        throw new Error('installed source receipt does not match the frozen commit');
      }
    });
  } catch (error) {
    if (previousAssociation) {
      runCommand(
        xdgMime,
        [
          'default',
          previousAssociation,
          `x-scheme-handler/${settings.deepLinkScheme}`,
        ],
        { env: environment, encoding: 'utf8', windowsHide: true },
      );
    }
    throw error;
  }

  return {
    installPath: settings.installPath,
    launcherPath: settings.launcherPath,
    desktopEntryPath: settings.desktopEntryPath,
    iconPath: settings.iconPath,
    sourceReceiptPath: settings.sourceReceiptPath,
  };
}

export function desktopInstallAdapter(platform) {
  if (platform === 'darwin') {
    return {
      platform,
      bundle: 'app',
      settings: macOSInstallSettings,
      prepare: () => ({ platform }),
      clean(root, settings) {
        fs.rmSync(this.resolveArtifact(root, settings), {
          recursive: true,
          force: true,
        });
      },
      resolveArtifact(root, settings) {
        return path.join(
          root,
          'apps',
          'desktop',
          'src-tauri',
          'target',
          'release',
          'bundle',
          'macos',
          `${settings.productName}.app`,
        );
      },
      install({ settings, sourcePath }) {
        replaceDesktopApplication(
          sourcePath,
          settings.installPath,
          signDesktopApplication,
        );
        return { installPath: settings.installPath };
      },
    };
  }
  if (platform === 'linux') {
    return {
      platform,
      bundle: 'appimage',
      settings: linuxInstallSettings,
      prepare(environment, findProgram, runCommand = spawnSync) {
        return assertLinuxDesktopDependencies(
          environment,
          findProgram,
          runCommand,
        );
      },
      clean: cleanLinuxAppImages,
      resolveArtifact: resolveLinuxAppImage,
      install: installLinuxDesktop,
    };
  }
  throw new DevctlError(
    ERROR_CODES.UNSUPPORTED_MODE,
    `Desktop installation is unavailable on ${platform}`,
    { platform, supportedPlatforms: ['darwin', 'linux'] },
  );
}
