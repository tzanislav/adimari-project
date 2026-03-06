import { auth } from '../firebase';

export const getAuthHeaders = async (extraHeaders = {}) => {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('Authentication required.');
  }

  const token = await currentUser.getIdToken();

  return {
    ...extraHeaders,
    Authorization: `Bearer ${token}`,
  };
};