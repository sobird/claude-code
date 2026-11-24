# Changelog

## [0.2.0](https://github.com/sobird/claude-code/compare/dsh-rcs-plugin-v0.1.0...dsh-rcs-plugin-v0.2.0) (2026-11-24)


### Features

* **dsh-rcs-plugin:** add environment mode config and state directory ([6f67277](https://github.com/sobird/claude-code/commit/6f67277d2d98cb7ab44f6cdc3480730ea60f2dfe))
* **dsh-rcs-plugin:** allow changing max sessions at runtime ([4e0aab9](https://github.com/sobird/claude-code/commit/4e0aab977b3d89a38269fd8ae3c28558b4206b45))
* **dsh-rcs-plugin:** attach sessions to their workspace and sync titles ([0fcc11c](https://github.com/sobird/claude-code/commit/0fcc11cdf032fb15889e329e3125c66a79cc6e6b))
* **dsh-rcs-plugin:** bridge RCS sessions inside the dsh host ([051f4b4](https://github.com/sobird/claude-code/commit/051f4b45bccdf7db51d98d3ebe89280162b32c67))
* **dsh-rcs-plugin:** publish the plugin to npm as an independent release ([01c9013](https://github.com/sobird/claude-code/commit/01c9013d99a75c28b2506edb262f3bef2e8b03f1))
* **dsh-rcs-plugin:** show the pairing code in the /rcs-login result ([e563ebe](https://github.com/sobird/claude-code/commit/e563ebee8150da066909663d19dfdf5da7bf9c95))
* **dsh-rcs-plugin:** supervise rcs environments and dispatch work ([769b0b2](https://github.com/sobird/claude-code/commit/769b0b2652983e317f4418a9a7bb9701288a79b0))
* **dsh-rcs-plugin:** sync a local dsh session to rcs on demand ([08d59b6](https://github.com/sobird/claude-code/commit/08d59b6f2c8a024e798ff4864f10fae9ea9cb925))
* **dsh-rcs-plugin:** sync dsh UI prompts, stream deltas, and reuse sessions ([c060212](https://github.com/sobird/claude-code/commit/c060212b301baa5d47caf98973ba02fbdab49601))
* **rcs:** pair the dsh plugin with a device code ([c320621](https://github.com/sobird/claude-code/commit/c320621f53b1fd7ea67771e025224e5b46410ac9))
* **rcs:** prefill the device code from a fragment link ([e20f5a2](https://github.com/sobird/claude-code/commit/e20f5a2e2be26d3740c7283edf08a86d2d51aa7d))


### Bug Fixes

* **dsh-rcs-plugin:** apply maxSessions locally before reporting it ([23a9eae](https://github.com/sobird/claude-code/commit/23a9eae81068de6a253eb80d61f61d78c29e1cbc))
* **dsh-rcs-plugin:** declare an input hint so the web composer claims rcs-max-sessions ([9eaee5d](https://github.com/sobird/claude-code/commit/9eaee5d855c153e736df631e4493143faaa8b282))
* **dsh-rcs-plugin:** name dispatched dsh sessions after the RCS title ([38fad0a](https://github.com/sobird/claude-code/commit/38fad0acc90ac7a39b97851517f6beac2e4a832d))
* **dsh-rcs-plugin:** refresh expired worker tokens on 401 ([0c6820f](https://github.com/sobird/claude-code/commit/0c6820f82469d796fd40268e2c012963490b1941))
* **dsh-rcs-plugin:** register slash commands in single mode with a hint ([f82b7bf](https://github.com/sobird/claude-code/commit/f82b7bf520a810790035b68f68d6320585907afe))
* **dsh-rcs-plugin:** release bridge listeners and work items on teardown ([8f8f100](https://github.com/sobird/claude-code/commit/8f8f1009873d7685d8e438cc03b9741317f0a81d))
