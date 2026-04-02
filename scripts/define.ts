import { bugs, name, version } from '../package.json';

type BuildTarget = 'ant' | 'external';
type BuildEnv = 'development' | 'production' | 'test';

export function define(
  buildEnv: BuildEnv = 'production',
  buildTraget: BuildTarget = 'external',
) {
  return {
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(bugs.url),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(`report the issue at ${bugs.url}`),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(name),
    'MACRO.PACKAGE_URL': JSON.stringify(name),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
    //
    'BUILD_TARGET': JSON.stringify(buildTraget), // external | ant
    'BUILD_ENV': JSON.stringify(buildEnv),
  };
}
