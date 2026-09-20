const { withXcodeProject } = require('@expo/config-plugins');

/**
 * The "Bundle React Native code and images" phase runs Metro, which reads the
 * project directory and writes main.jsbundle into DerivedData. Xcode 27's
 * template sets ENABLE_USER_SCRIPT_SANDBOXING = YES, which denies both and
 * fails the build. Prebuild regenerates project.pbxproj, so this has to be a
 * plugin rather than an edit in Xcode.
 */
module.exports = (config) =>
  withXcodeProject(config, (cfg) => {
    const sections = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const section of Object.values(sections)) {
      if (section?.buildSettings?.PRODUCT_NAME) {
        section.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      }
    }
    return cfg;
  });
