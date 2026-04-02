import { bugs, name, version } from '../package.json';

export const define = {
  'MACRO.VERSION': JSON.stringify(version),
  'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify(bugs.url),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify(`report the issue at ${bugs.url}`),
  'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(name),
  'MACRO.PACKAGE_URL': JSON.stringify(name),
  'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
  //
  'MACRO.USER_TYPE': JSON.stringify('external'),
};
