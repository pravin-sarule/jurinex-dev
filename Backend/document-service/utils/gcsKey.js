exports.normalizeGcsKey = (raw, bucketName) => {
  if (!raw) return '';
  let key = String(raw);
  key = key.replace(/^https?:\/\/storage\.googleapis\.com\//, '');
  key = key.replace(/^gs:\/\//, '');
  key = key.replace(new RegExp(`^${bucketName}/`), '');
  return key;
};
