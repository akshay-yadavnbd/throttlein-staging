import type { AxiosInstance } from 'axios';

/**
 * Download a PDF the API streams (e.g. tax invoices). It needs the auth
 * header, so a plain link can't fetch it; the bytes come back as a Blob and
 * are saved under the server's filename. Throws an Error carrying the API's
 * own message — error bodies arrive as a Blob too and are unwrapped here.
 */
export async function downloadPdf(client: AxiosInstance, path: string, fallbackName: string) {
  let res;
  try {
    res = await client.get(path, { responseType: 'blob' });
  } catch (e: any) {
    const data = e?.response?.data;
    let message = '';
    if (data instanceof Blob) {
      try { message = JSON.parse(await data.text())?.message || ''; } catch { message = ''; }
    }
    throw new Error(message || e?.message || 'Download failed');
  }
  const disposition = String(res.headers['content-disposition'] || '');
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
