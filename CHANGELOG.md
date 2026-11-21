# Changelog

## [1.1.0](https://github.com/sobird/claude-code/compare/v1.0.0...v1.1.0) (2026-11-21)


### Features

* **bridge:** include the plan body in ExitPlanMode permission requests ([ecd3434](https://github.com/sobird/claude-code/commit/ecd343414371a043c03cfad476113ada98fa336b))
* **byoc:** implement the environment-runner container session runner ([4b9c52e](https://github.com/sobird/claude-code/commit/4b9c52e97c16b7b23d62a6ccd988ea9b9b246022))
* **cli:** implement background sessions with tmux ([f767c12](https://github.com/sobird/claude-code/commit/f767c12c101809fbce0be3ba3403eb77dcd06ae2))
* **daemon:** close the assistant cold-start loop ([5aa471a](https://github.com/sobird/claude-code/commit/5aa471a3becd065acbe41a9ffa7bb136f4a2358c))
* **fork:** implement the /fork slash command ([c965b97](https://github.com/sobird/claude-code/commit/c965b979b2dd488d88fc5e7ebe2247afff5a2d7c))
* implement auto-generated stubs ([2c842e4](https://github.com/sobird/claude-code/commit/2c842e4f10ab0cc1eb925343764b0fa8de588c57))
* implement peers, workflows and force-snip commands ([6f89efe](https://github.com/sobird/claude-code/commit/6f89efe4384fc950bcc4d69a89ebcf0c678baa5c))
* **oauth:** replace any-typed stubs with real wire and storage types ([79668be](https://github.com/sobird/claude-code/commit/79668bea68a1a85e9ee43d36c06071a260c886ac))
* **proactive:** implement the state store and REPL tick scheduler ([b20db34](https://github.com/sobird/claude-code/commit/b20db347fd0d89dfb07026e9421851b9de3f63b6))
* **rcs:** add @ file completion to the web composer ([d1f9830](https://github.com/sobird/claude-code/commit/d1f98302c435486e7b886d8f3a8fb7d71d39546e))
* **rcs:** add Base UI and port Button/Badge to render ([fad0c40](https://github.com/sobird/claude-code/commit/fad0c4062ac17151af5a70175c6ee286c75d87e5))
* **rcs:** add message catalogs and next-intl request wiring ([80ce8e7](https://github.com/sobird/claude-code/commit/80ce8e791e760f2a182adcf13beb4f0207dd908b))
* **rcs:** add mode cycling, model switching, and history search ([c376d93](https://github.com/sobird/claude-code/commit/c376d93bb018f3d59e6c4ee7a10ccd54bf0792b1))
* **rcs:** add remote-control-server command and named daemon state ([8d44766](https://github.com/sobird/claude-code/commit/8d44766b61ccfa6caa6fa0f8025dfbe6e444689a))
* **rcs:** expand brand manual and port asset pipeline to TypeScript ([0360e19](https://github.com/sobird/claude-code/commit/0360e19d4e47a59993f4a4fb17bb1dd974624e45))
* **rcs:** render subagent transcripts under their Agent card ([0cc092c](https://github.com/sobird/claude-code/commit/0cc092c7f84e8d399cc741aa9a99bca118e62522))
* **rcs:** serve the service worker with the Serwist Turbopack adapter ([46edf50](https://github.com/sobird/claude-code/commit/46edf50efe8a23f9ff61e02c1f9ec91eac7a26de))
* **self-hosted-runner:** implement the standalone headless bridge worker ([15f6657](https://github.com/sobird/claude-code/commit/15f66578d314b98345937d48d8f1909fe116d981))
* **server:** implement claude server direct-connect ([c22c03e](https://github.com/sobird/claude-code/commit/c22c03e88581b3468f0bc85d2641aa60c99e297c))
* **services:** implement the remaining services stubs ([8d4efa3](https://github.com/sobird/claude-code/commit/8d4efa3756af6ccdf0968bc9a890890521f2affa))
* **ssh:** implement claude ssh remote sessions ([0d5df2a](https://github.com/sobird/claude-code/commit/0d5df2a6221f62bef15713cb41e738a15001a823))
* **tools:** implement the remaining feature-gated tool stubs ([c86cded](https://github.com/sobird/claude-code/commit/c86cdedd760fd362fee9fcfa54d68bd03535fcfa))
* **upgrade:** carve JS module graph from native upstream releases ([dbb860f](https://github.com/sobird/claude-code/commit/dbb860fdc4b9c41f88dd7d6303829a7546b81bcb))
* **upgrade:** port upstream 2.1.90 ([ca47e8f](https://github.com/sobird/claude-code/commit/ca47e8fb8842a50c0977c10931a540fd5c706d3a))
* **upgrade:** port upstream 2.1.91 and evolve upgrade pipeline ([369e4fd](https://github.com/sobird/claude-code/commit/369e4fdd814b809d1da86443041480b03f37970a))
* **utils:** implement the remaining utils function stubs ([cc98c99](https://github.com/sobird/claude-code/commit/cc98c9922da18a292b2fd1bdc095f2b792ec5391))
* **webhooks:** add GitHub PR activity subscription client ([333a89d](https://github.com/sobird/claude-code/commit/333a89d56fcf975533b1883f1bf5658650f47b54))


### Bug Fixes

* **bridge:** bypass claude.ai gates for self-hosted servers ([df03cf8](https://github.com/sobird/claude-code/commit/df03cf87ff40fa2d98776f9a8cf7cdf0d60bbe57))
* **bridge:** forward runtime defines to spawned session children ([3f11b26](https://github.com/sobird/claude-code/commit/3f11b267c8906f5ceda2d28dd7ec097167464d30))
* **bridge:** unblock self-hosted remote control with KAIROS enabled ([2c6f095](https://github.com/sobird/claude-code/commit/2c6f0959838fd9e49da361919923938227f4521c))
* **bridge:** use wss when the session ingress base URL is https ([0984ce2](https://github.com/sobird/claude-code/commit/0984ce23f3628c256b942ad9254a7d00b96a5b1c))
* **build:** copy vendor binaries into dist ([c7c41e6](https://github.com/sobird/claude-code/commit/c7c41e6ddd821b112cb4b0c3401d73daf00d9e55))
* **ci:** run CI on main and bootstrap rcs releases at 0.0.0 ([613d846](https://github.com/sobird/claude-code/commit/613d8465c2784216ccdce03b2abf59a1f8230efc))
* **ci:** stabilize cross-platform tests and unblock install ([b8401f2](https://github.com/sobird/claude-code/commit/b8401f2113b726678f719f60bc18d5ab2ebbec23))
* **ci:** treat Windows temp cleanup failures as best effort ([c042bb2](https://github.com/sobird/claude-code/commit/c042bb25a8ff4ba948759e5a845cc628b4a354c2))
* **daemon:** handle spawn failures and surface parked workers ([ee867c3](https://github.com/sobird/claude-code/commit/ee867c3804f4796bf488b2956185e789392244cb))
* **daemon:** harden start path against races and dead workers ([1df3ee7](https://github.com/sobird/claude-code/commit/1df3ee789458c9087ff9ee08bf873e19f503d318))
* drop redundant type assertions flagged by no-unnecessary-type-assertion ([92b669c](https://github.com/sobird/claude-code/commit/92b669ce1781b9bcaa1b2e0a16d312b172f9ec8a))
* **e2e:** make the suites pass on CI without the repo .env ([9d53102](https://github.com/sobird/claude-code/commit/9d53102b70fb81a510338ed663216af7153f272c))
* **e2e:** provision ripgrep and use a Python pty on macOS ([0a1cccc](https://github.com/sobird/claude-code/commit/0a1cccc6c268d5c4081a753473b04f5228ff54f6))
* **lint:** clear the remaining lint errors ([48f6c1e](https://github.com/sobird/claude-code/commit/48f6c1eaf3101172bcdada049cf78ef383edcd0d))
* **lint:** restore generic signatures and V8 flat-string copy ([013a793](https://github.com/sobird/claude-code/commit/013a793f7a9d609af0100ab8cde7126690fb89d4))
* **rcs:** block cross-tenant session binding and revive reaped environments ([4465d7f](https://github.com/sobird/claude-code/commit/4465d7f4679e77ea533a88226da48e762cb1ed0a))
* **release:** pin rcs initial version to 0.1.0 ([0bcc42e](https://github.com/sobird/claude-code/commit/0bcc42e050bcce8097b966a51c9c4ee9e1d50c94))
* **server:** terminate the process after a headless connect run ([82f17d7](https://github.com/sobird/claude-code/commit/82f17d7f9663deee9b24124b584046fa8d4ede95))
* **version:** report the fork's own package version ([1f4f426](https://github.com/sobird/claude-code/commit/1f4f42660f10275a89d6b7188f6fd179033e9152))

## 1.0.0 (2026-04-19)


### Features

* add macOS modifier key detection module ([5e9233c](https://github.com/sobird/claude-code/commit/5e9233c7b9cfdb069de8bbf26dcfbe75fa93dd0c))
* add TungstenPill component and internal tooling support ([bb9823e](https://github.com/sobird/claude-code/commit/bb9823e7ed55c8d6a6b104e76dcb77cebf2f5e56))
* add TypeScript type definitions and utility modules ([f2cc2fb](https://github.com/sobird/claude-code/commit/f2cc2fbe41680905895d07aa3871fd968d9c76c9))
* add ultraplan multi-agent exploration framework fixes [#5](https://github.com/sobird/claude-code/issues/5) ([3d24d3a](https://github.com/sobird/claude-code/commit/3d24d3ac8f355a1b6e7c0eada06178bf49f2c722))
* add undercover mode auto notice and TTFT metrics display fixes [#3](https://github.com/sobird/claude-code/issues/3) ([32d0ac0](https://github.com/sobird/claude-code/commit/32d0ac0d93283bb553075d28e93535e9a511814e))
* add undercover mode support with ANT build target ([0faa0ca](https://github.com/sobird/claude-code/commit/0faa0ca9476b449dec8c7ef42778ef9416598c85))
* add verification system ([b1d4757](https://github.com/sobird/claude-code/commit/b1d4757598ce5f991e2a7ef1f1eb36331bb704a1))
* **modifiers-napi:** test release please ([62ac437](https://github.com/sobird/claude-code/commit/62ac437c96457028272caffc5923444a47418c63))


### Bug Fixes

* -d2e & add bufig.toml define MACRO ([1b756de](https://github.com/sobird/claude-code/commit/1b756de059a6b86161f2d1fc800f3e5345dd1375))
* [BUG] /agents 命令无法获取项目级 agents fixes [#2](https://github.com/sobird/claude-code/issues/2) ([fb19857](https://github.com/sobird/claude-code/commit/fb19857f2a5aa9f2861bfd7a0519b80833ea8f92))
* /config ERROR Gates is not defined when process.env.USER_TYPE === 'ant' ([1e38cd0](https://github.com/sobird/claude-code/commit/1e38cd07884d1eb717f78e81cd2989c37136d039))
* initial release version: 2.1.88 ([7bcbcb0](https://github.com/sobird/claude-code/commit/7bcbcb0b3409c672da5451c052c41dbcaa768191))
* pure TypeScript port of color-diff-napi ([a4b4291](https://github.com/sobird/claude-code/commit/a4b429130b1b096ee62945a352f9d1648543eb3d))
* tools interface stub impl ([2a5bb50](https://github.com/sobird/claude-code/commit/2a5bb50b9ea28912a5127b01dec2f40a8f74134f))
* update all .tsx file source base //# sourceMappingURL=data:application/json ([65f41ba](https://github.com/sobird/claude-code/commit/65f41ba1e9982cd6e24ade8aca8718be988af101))
* update process.env.NODE_ENV in the tsx file ([156cd98](https://github.com/sobird/claude-code/commit/156cd98fc7aba46fe2e45fca636285e291a0fd6a))
* 移除bun build 的 define 中的'process.env.NODE_ENV': '"production"' ([e831dc8](https://github.com/sobird/claude-code/commit/e831dc8f75adbff78955d9b61268d0c176bf76c2))


### Build System

* update build scripts ([b1fadf6](https://github.com/sobird/claude-code/commit/b1fadf6d85ebccd02ada89adbe7ca1c40f812ba7))
* update build workflow ([0c8735a](https://github.com/sobird/claude-code/commit/0c8735afea47c4f9d76fd572bd1c66a7d001462f))
