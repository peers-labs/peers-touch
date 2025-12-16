Logging configuration

peers.logger.name: slogrus
peers.logger.level: info
peers.logger.caller-skip-count: 0

peers.logger.persistence.enable: true
peers.logger.persistence.dir: /var/log/peers-touch
peers.logger.persistence.back-dir: /var/log/peers-touch/backup
peers.logger.persistence.max-file-size: 50
peers.logger.persistence.max-backup-size: 700
peers.logger.persistence.max-backup-keep-days: 14
peers.logger.persistence.file-name-pattern: peers-touch.log
peers.logger.persistence.backup-file-name-pattern: app-%Y%m%d-%H.zip

peers.logger.slogrus.formatter: text
peers.logger.slogrus.report-caller: false
peers.logger.slogrus.split-level: false
peers.logger.slogrus.without-key: false
peers.logger.slogrus.without-quote: false
peers.logger.slogrus.timestamp-format: 2006-01-02 15:04:05.999
peers.logger.slogrus.include-packages: []
peers.logger.slogrus.exclude-packages: []

Notes

file-name-pattern controls base name for single file and level files.
When split-level is true, level files are named as <base>-<level>.log in dir.
backup files use lumberjack timestamped naming in back-dir.
