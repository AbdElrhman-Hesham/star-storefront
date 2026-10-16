/**
 * STAR Frontend Config
 * Values are read from <meta> tags set in the HTML pages.
 * The Cloudflare Worker serves the API from the same domain at /api.
 */
(function () {
  const getMeta = (name) => {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute('content') : null;
  };

  const params = new URLSearchParams(window.location.search);
  const adminPreview = params.get('adminPreview') === '1';
  const adminPreviewToken = adminPreview ? localStorage.getItem('star_admin_token') || '' : '';

  window.getAdminPreviewFetchOptions = (extra = {}) => {
    const headers = {
      ...(extra.headers || {}),
      ...(adminPreviewToken ? { Authorization: `Bearer ${adminPreviewToken}` } : {}),
    };

    return {
      ...extra,
      headers,
    };
  };

  window.STAR_CONFIG = {
    API_URL:   getMeta('star-api-url')   || '/api',
    WHATSAPP:  getMeta('star-whatsapp')  || '201000000000',
    ADMIN_PREVIEW: adminPreview,
    ADMIN_TOKEN: adminPreviewToken,
  };
})();
