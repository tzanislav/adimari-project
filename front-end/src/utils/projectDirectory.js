const serverUrl = import.meta.env.VITE_SERVER_URL || '';

export function projectThumbnailUrl(path) {
  return path?.startsWith('/api/project-directory/images/') ? `${serverUrl}${path}` : path;
}
