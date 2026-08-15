import { fetchWithAuth, getAuthHeaders } from './authHeaders';

const apiBaseUrl = (import.meta.env.VITE_FILE_SYNC_API_BASE_URL || '/file-sync-api').replace(/\/$/, '');

class FileSyncApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'FileSyncApiError';
    this.status = status;
  }
}

const request = async (path, options = {}) => {
  const response = await fetchWithAuth(`${apiBaseUrl}${path}`, options);

  if (!response.ok) {
    const responseText = await response.text();
    throw new FileSyncApiError(responseText || 'The NAS file service is temporarily unavailable.', response.status);
  }

  return response;
};

export const getStorageNodes = async () => (await request('/api/storage-nodes')).json();

export const getFolderPage = async (storageNodeId, parentPath, cursor = null) => {
  const query = new URLSearchParams({ storageNodeId, parentPath, pageSize: '100' });

  if (cursor) {
    query.set('cursor', cursor);
  }

  return (await request(`/api/folders?${query.toString()}`)).json();
};

export const getDownloadRequests = async (storageNodeId) => {
  const query = new URLSearchParams({ storageNodeId });
  return (await request(`/api/download-requests?${query.toString()}`)).json();
};

export const createDownloadRequest = async (storageNodeId, relativePath) => (
  await request('/api/download-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storageNodeId, relativePath }),
  })
).json();

export const createShareLink = async (storageNodeId, relativePath) => (
  await request('/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storageNodeId, relativePath }),
  })
).json();

export const cancelDownloadRequest = async (requestId) => (
  await request(`/api/download-requests/${encodeURIComponent(requestId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
).json();

export const uploadFiles = async (storageNodeId, targetFolderPath, files, { onProgress, onRequestBodyUploaded } = {}) => {
  const formData = new FormData();
  formData.append('storageNodeId', storageNodeId);
  formData.append('targetFolderPath', targetFolderPath);

  Array.from(files).forEach((file) => formData.append('files', file, file.name));

  const headers = await getAuthHeaders();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBaseUrl}/api/browser-uploads`);
    xhr.setRequestHeader('Authorization', headers.Authorization);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };
    xhr.upload.onload = () => onRequestBodyUploaded?.();
    xhr.onerror = () => reject(new FileSyncApiError('The upload connection was interrupted.'));
    xhr.onload = () => {
      let result = null;

      try {
        result = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        result = null;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new FileSyncApiError(
          typeof result === 'string' ? result : 'The NAS file service could not upload the selected files.',
          xhr.status,
        ));
        return;
      }

      resolve(result);
    };
    xhr.send(formData);
  });
};

export const downloadCompletedFile = async (requestId) => (
  await request(`/api/downloads/${encodeURIComponent(requestId)}`)
).blob();
