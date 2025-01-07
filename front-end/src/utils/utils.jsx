/**
 * Extracts and decodes the file name from a URL.
 * @param {string} url - The URL of the file.
 * @param {number} maxLength - The maximum length of the returned name (default: 20).
 * @returns {string} The decoded and truncated file name.
 */
export const showOnlyName = (url, maxLength = 20) => {
    if (!url) return '';
    const newName = url.split('/').pop(); // Extract file name from URL
    const decodedName = decodeURIComponent(newName); // Decode URL encoding
    const finalName = new TextDecoder('utf-8').decode(
      new Uint8Array(decodedName.split('').map((c) => c.charCodeAt(0)))
    );
    return finalName.length > maxLength ? finalName.substring(0, maxLength) + '...' : finalName;
  };
  