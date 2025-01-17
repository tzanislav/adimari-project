const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { OpenAI } = require('openai');

const router = express.Router();

// Use Puppeteer Stealth Plugin
puppeteer.use(StealthPlugin());

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Replace with your actual API key
});

// Route to get content from Bing and extract price
router.get('/', async (req, res) => {
  const { query } = req.query;
  const newQuery = query + ' price'; // Append 'price' to the query to help OpenAI extract prices
  console.log('Query:', newQuery);
  if (!query) {
    return res.status(400).json({ error: 'Please provide a query parameter.' });
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    const page = await browser.newPage();

    // Set user agent to mimic a real browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
    );

    // Set realistic viewport
    await page.setViewport({ width: 1280, height: 720 });

    // Add extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    // Navigate to Bing
    await page.goto('https://www.bing.com', { waitUntil: 'networkidle2' });

    // Type the search query into the search bar and press Enter
    try {
      await page.waitForSelector('textarea#sb_form_q', { timeout: 5000 });
      await page.type('textarea#sb_form_q', newQuery, { delay: 150 }); // Type with delay
      await page.keyboard.press('Enter'); // Simulate pressing Enter
    } catch (err) {
      console.error('Search bar not found:', err);
      return res.status(500).json({ error: 'Failed to locate the search bar on Bing.' });
    }

    // Wait for results to load
    try {
      await page.waitForSelector('#b_results', { timeout: 10000 });
    } catch (err) {
      console.error('Search results did not load:', err);
      return res.status(500).json({ error: 'Bing search results did not load.' });
    }

    //wait 1 second to let the page load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Extract content from the search results
    const organicResults = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('#b_results > li.b_algo'));
      return elements.map((el) => el.innerText.trim()).join('\n\n'); // Join results with double line breaks
    });

    await browser.close(); // Close the browser

    console.log('Extracted Results:', organicResults);

    // Send the result to OpenAI API for price extraction
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant.
          Extract the price in any currency of the item in the following 
          text or estimate the price based on your opinion 
          and return a JSON formatted answer containing only the price in the 
          format{
               "price": "XXX.XX",
                "status": "found"
                }
          (no commas for the number or anything except a valid float) Where the status is wether the price is base on the text ("found") or based on an estimation ("estimate").
          Even if you are not sure, please provide an estimate based on the information: ${query}
          When estimatin, take into account the brand class and what similar items cost, also the text is context for the item. Work in euro please, even if you find the price in dollars or any other currency try to convert it.
          Try to be as accurate as possible.
          The answer shoud be exclusively valid JSON.`,
        },
        {
          role: 'user',
          content: organicResults,
        },
      ],
    });

    const openAIResult = response.choices[0].message.content;
    const cleanJSON = openAIResult.replace(/```json|```/g, '').trim();

    console.log('OpenAI Response:', openAIResult);

    // Parse and validate the JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(cleanJSON);
      console.log('Parsed OpenAI Response:', parsedResponse);
    } catch (error) {
      console.error('Failed to parse OpenAI response as JSON:', error);
      return res.status(500).json({ error: 'Invalid JSON response from OpenAI.' });
    }

    // Validate that the JSON contains a `price` field
    if (parsedResponse && typeof parsedResponse.price !== 'undefined') {
      return res.json({ query, price: parsedResponse.price, status: parsedResponse.status });
    } else {
      console.error('OpenAI response does not contain a valid price:', parsedResponse);
      return res.status(500).json({ error: 'OpenAI response does not contain a valid price.' });
    }

  } catch (error) {
    console.error('Error extracting price:', error);
    return res.status(500).json({ error: 'Failed to extract price.', details: error });
  }
});

module.exports = router;
