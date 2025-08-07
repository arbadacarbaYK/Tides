const giphyService = (function() {
  const GIPHY_API_KEY = '2OFaf9yEsoNzXCJ9aNNKo9SVXc4YNXei';
  const GIPHY_API_URL = 'https://api.giphy.com/v1/gifs';

  async function searchGifs(query, limit = 20) {
    const url = `${GIPHY_API_URL}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=${limit}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.data.map(gif => ({
      id: gif.id,
      url: gif.images.original.url,
      previewUrl: gif.images.fixed_height.url,
      width: gif.images.original.width,
      height: gif.images.original.height
    }));
  }

  async function getTrendingGifs(limit = 20) {
    const url = `${GIPHY_API_URL}/trending?api_key=${GIPHY_API_KEY}&limit=${limit}`;
    const response = await fetch(url);
    const data = await response.json();
    return data.data.map(gif => ({
      id: gif.id,
      url: gif.images.original.url,
      previewUrl: gif.images.fixed_width.url,
      width: gif.images.fixed_width.width,
      height: gif.images.fixed_width.height
    }));
  }

  return {
    searchGifs,
    getTrendingGifs
  };
})();