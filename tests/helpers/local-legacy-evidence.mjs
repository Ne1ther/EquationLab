// Private historical inputs are never included in a clean checkout.
export const localLegacyEnabled = process.env.EQUATIONLAB_LOCAL_LEGACY_TESTS === '1';
export const localLegacyOptions = {
  skip: localLegacyEnabled ? false : 'Private historical corpus: set EQUATIONLAB_LOCAL_LEGACY_TESTS=1 with the required local files.'
};
