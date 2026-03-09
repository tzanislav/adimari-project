import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

const waitForCurrentUser = async () => {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
};

export const getAuthHeaders = async (extraHeaders = {}, { forceRefresh = false } = {}) => {
  const currentUser = await waitForCurrentUser();

  if (!currentUser) {
    throw new Error('Authentication required.');
  }

  const token = await currentUser.getIdToken(forceRefresh);

  return {
    ...extraHeaders,
    Authorization: `Bearer ${token}`,
  };
};

export const fetchWithAuth = async (url, options = {}) => {
  const { headers: extraHeaders = {}, ...requestOptions } = options;

  let headers = await getAuthHeaders(extraHeaders);
  let response = await fetch(url, {
    ...requestOptions,
    headers,
  });

  if (response.status === 401 || response.status === 403) {
    headers = await getAuthHeaders(extraHeaders, { forceRefresh: true });
    response = await fetch(url, {
      ...requestOptions,
      headers,
    });
  }

  return response;
};