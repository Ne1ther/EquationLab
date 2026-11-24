// Share the compressed page limits across the HTTP, session and worker layers.
export const MAX_COMPRESSED_CATALOGUE_PAGE_BYTES=16*1024*1024;
export const MAX_CATALOGUE_PAGE_BASE64=4*Math.ceil(MAX_COMPRESSED_CATALOGUE_PAGE_BYTES/3);
export const MAX_CATALOGUE_REQUEST_BYTES=MAX_CATALOGUE_PAGE_BASE64+4096;
