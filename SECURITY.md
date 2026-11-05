# Security policy

## Supported versions

Only the latest release receives security fixes. The Chrome Web Store and Edge Add-ons update installed copies automatically.

## Reporting a vulnerability

Report privately through [GitHub's private vulnerability reporting](https://github.com/xjin9612/marklens/security/advisories/new). Do not open a public issue.

Please include:

- The MarkLens version and browser version
- A Markdown file or page that reproduces the problem
- What an attacker can do with it, for example run script, read other files or write to a file

Problems in bundled third-party libraries (under `vendor/`) are welcome too. If the library itself is at fault, please also report it to that project.

## Scope

In scope: anything that lets a Markdown document, a website or another extension run code in MarkLens, read files the user didn't open, write to files other than the checked task line, or bypass the HTML filter.

The security design is described in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#安全設計) (in Traditional Chinese).
