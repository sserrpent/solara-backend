/**
 * Backend Server Entry Point
 * --------------------------
 * This is the main "brain" the application.
 * It uses Express.js to create a web server.
 * 
 * It handles:
 * 1. API Requests (Frontend asking for data).
 * 2. Authentication (Login/Register).
 * 3. Data Processing (Crunching the NHANES numbers).
 */

// Express is the framework that runs the web server.
const express = require('express');

// CORS allows the frontend (port 5173) to talk to this backend (port 3000).
// Without this, the browser blocks the connection for security.
const cors = require('cors');

// FS and Path are for reading files (like our dataset).
const fs = require('fs');
const path = require('path');

// JWT (JSON Web Tokens) are like digital ID cards. 
// When a user logs in, we give them a token. They show this token to get their data.
const jwt = require('jsonwebtoken'); 

// Import our simple file-based user manager we created.
const userManager = require('./simpleDb'); 

// Create the app
const app = express();
const PORT = process.env.PORT || 3000; // Run on port 3000

// A secret key used to sign the tokens. In a real app, this is hidden.
const SECRET_KEY = 'super_secret_key_change_in_production';

// --- 1. Load Data ---
// We read the 'nhanes_sun.json' file immediately when the server starts.
const dataPath = path.join(__dirname, '..', 'data', 'nhanes_sun.json');
let nhanesData = [];

try {
  // Read file as text ('utf8')
  const raw = fs.readFileSync(dataPath, 'utf8');
  // Parse text into JSON array
  nhanesData = JSON.parse(raw);
  console.log('NHANES data loaded successfully. Records:', nhanesData.length);
} catch (err) {
  console.error('Failed to load NHANES data:', err.message);
}

// --- 2. Middleware ---
// .use() adds plugins to our server.
// Enable CORS specifically for your frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://solara-g8-production.up.railway.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); // Allow server to read JSON data sent in POST requests

// --- 3. Constants ---
// Maps numbers to human-readable strings for the frontend
const sexMap = { 1: 'Male', 2: 'Female' };
const skinReactionMap = {
  1: 'Severe sunburn with blisters',
  2: 'Moderate sunburn with peeling',
  3: 'Mild burn followed by tanning',
  4: 'Just darker without burning',
  5: 'Nothing would happen',
  6: 'Other',
  77: 'Refused',
  99: "Don't know",
};

// --- 4. Logic Functions (The Math) ---

/**
 * Calculates valid filter options based on the data we have.
 * Returns unique lists of Sexes and Skin Types found in the dataset.
 */
function computeFilters() {
  const sexSet = new Set();
  const skinSet = new Set();
  let minAge = Infinity;
  let maxAge = -Infinity;

  nhanesData.forEach(row => {
    // Add unique values to Sets
    if (row.RIAGENDR) sexSet.add(row.RIAGENDR);
    if (row.DED031) skinSet.add(row.DED031);
    
    // Find min/max age
    const age = row.RIDAGEYR;
    if (typeof age === 'number' && !Number.isNaN(age)) {
      if (age < minAge) minAge = age;
      if (age > maxAge) maxAge = age;
    }
  });

  // Convert Sets to Arrays and map to labels
  return { 
      sexes: Array.from(sexSet).sort().map(code => ({ code, label: sexMap[code] })),
      skins: Array.from(skinSet).sort().map(code => ({ code, label: skinReactionMap[code] })),
      minAge, 
      maxAge 
  };
}

/**
 * Sanity check for minutes.
 * Ensures we don't count crazy values (like negative time or > 24 hours).
 */
function validMinutes(value) {
  if (value == null) return null;
  const num = Number(value);
  if (isNaN(num) || num < 0 || num > 1440) return null; // 1440 mins = 24 hours
  return num;
}

/**
 * THE MAIN ALGORITHM: Compute Summary
 * Filters the dataset to find people "like the user" and calculates averages.
 */
function computeSummary(params) {
  // Parse the query parameters from the URL
  const sexParam = params.sex ? Number(params.sex) : null;
  const minAgeParam = params.minAge ? Number(params.minAge) : null;
  const maxAgeParam = params.maxAge ? Number(params.maxAge) : null;
  const skinParam = params.skin ? Number(params.skin) : null;

  let total = 0; // Count of matching people
  let sunburnCount = 0; // How many had sunburn
  let workMinutesSum = 0;
  let workMinutesCount = 0;
  let nonWorkMinutesSum = 0;
  let nonWorkMinutesCount = 0;

  // Loop through every person in the NHANES dataset
  nhanesData.forEach(row => {
    // FILTER: Skip if they don't match the user's sex
    if (sexParam !== null && row.RIAGENDR !== sexParam) return;
    // FILTER: Skip if they don't match the user's skin type
    if (skinParam !== null && row.DED031 !== skinParam) return;
    // FILTER: Skip if they are outside the age range
    if (minAgeParam !== null && row.RIDAGEYR < minAgeParam) return;
    if (maxAgeParam !== null && row.RIDAGEYR > maxAgeParam) return;

    // Found a match!
    total++;

    // Check if they reported sunburn (DED038Q > 0)
    if (row.DED038Q && row.DED038Q > 0) {
      sunburnCount++;
    }

    // Add up their sun exposure minutes (Work days)
    const workMins = validMinutes(row.DED120);
    if (workMins !== null) {
      workMinutesSum += workMins;
      workMinutesCount++;
    }

    // Add up their sun exposure minutes (Non-Work days)
    const nonWorkMins = validMinutes(row.DED125);
    if (nonWorkMins !== null) {
      nonWorkMinutesSum += nonWorkMins;
      nonWorkMinutesCount++;
    }
  });

  // Calculate Averages
  return {
    total,
    sunburnCount,
    sunburnRate: total > 0 ? (sunburnCount / total) * 100 : 0,
    averageWorkDayMinutes: workMinutesCount > 0 ? workMinutesSum / workMinutesCount : 0,
    averageNonWorkDayMinutes: nonWorkMinutesCount > 0 ? nonWorkMinutesSum / nonWorkMinutesCount : 0
  };
}

/**
 * Compute Trends
 * Groups people by age to show how exposure changes over time.
 */
function computeTrends(params) {
  const sexParam = params.sex ? Number(params.sex) : null;
  const skinParam = params.skin ? Number(params.skin) : null;

  // Initialize age buckets (10-19, 20-29, etc.)
  const ageGroups = {};
  for (let i = 10; i < 80; i += 10) {
    ageGroups[`${i}-${i+9}`] = { total: 0, workSum: 0, workCount: 0, nonWorkSum: 0, nonWorkCount: 0 };
  }
  ageGroups['80+'] = { total: 0, workSum: 0, workCount: 0, nonWorkSum: 0, nonWorkCount: 0 };

  nhanesData.forEach(row => {
    // Filter by Sex/Skin only
    if (sexParam !== null && row.RIAGENDR !== sexParam) return;
    if (skinParam !== null && row.DED031 !== skinParam) return;
    
    // Determine which age bucket they fall into
    const age = row.RIDAGEYR;
    if (typeof age !== 'number' || isNaN(age)) return;

    let groupKey = '';
    if (age >= 80) groupKey = '80+';
    else {
      const lower = Math.floor(age / 10) * 10; // e.g. 25 -> 20
      if (lower < 10) return; // Skip kids under 10
      groupKey = `${lower}-${lower+9}`;
    }

    const bucket = ageGroups[groupKey];
    if (!bucket) return; 

    // Add data to bucket
    bucket.total++;
    const workMins = validMinutes(row.DED120);
    if (workMins !== null) { bucket.workSum += workMins; bucket.workCount++; }
    const nonWorkMins = validMinutes(row.DED125);
    if (nonWorkMins !== null) { bucket.nonWorkSum += nonWorkMins; bucket.nonWorkCount++; }
  });

  // Calculate final averages for each group
  return Object.keys(ageGroups).map(key => {
    const b = ageGroups[key];
    const avgWork = b.workCount > 0 ? b.workSum / b.workCount : 0;
    const avgNonWork = b.nonWorkCount > 0 ? b.nonWorkSum / b.nonWorkCount : 0;
    // Weighted Average: 5 work days + 2 weekends
    const overallAvg = (avgWork * 5 + avgNonWork * 2) / 7;
    
    return {
      ageRange: key,
      averageMinutes: Math.round(overallAvg),
      sampleSize: b.total
    };
  });
}

// --- 5. Security Middleware ---

/**
 * PROTEA: authenticateToken
 * Checks if the user sent a valid "Authorization" header with their request.
 * If yes, it adds the user info to the request (req.user).
 * If no, it blocks them (401/403).
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Header looks like: "Bearer <TOKEN_STRING>"
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401); // 401: Unauthorized (No token)

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403); // 403: Forbidden (Bad token)
    req.user = user; // Attach user info to request so next function can use it
    next(); // Proceed to the next step
  });
};

// --- 6. API Routes (The Endpoints) ---

// Public: Get filter options
app.get('/api/filters', (req, res) => {
  res.json(computeFilters());
});

// Protected: Get user summary (Needs Token)
app.get('/api/summary', (req, res) => {
  res.json(computeSummary(req.query));
});

// Protected: Get trends (Needs Token)
app.get('/api/trends', (req, res) => {
  res.json(computeTrends(req.query));
});

// Registration (Sign Up)
// Note: Passwords are NOT encrypted as requested for simplicity
const registerUser = (req, res) => {
  const { email, password, age, sex, skinColor, skinSensitivityCode, dailySunMinutes } = req.body;

   if (!email || !password) {
     return res.status(400).json({ error: 'Email and password are required' });
   }
 
   try {
     // Create user in our simple JSON DB
     const newUser = userManager.create({
         email, 
         password, 
         age, 
         sex, 
         skinColor, 
         skinSensitivityCode, 
         dailySunMinutes
     });

     // Generate a token for them immediately
     const token = jwt.sign({ id: newUser.id, email: newUser.email }, SECRET_KEY, { expiresIn: '24h' });
     res.status(201).json({ message: 'User registered successfully', token });
   } catch (e) {
     if (e.message === 'User already exists') {
         return res.status(409).json({ error: 'User already exists' });
     }
     res.status(500).json({ error: 'Server error' });
   }
};

app.post('/api/user', registerUser);
app.post('/api/auth/register', registerUser);

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
      const user = userManager.findByEmail(email);
      
      // Simple Password Check (String comparison)
      if (user && user.password === password) {
          // Success! Give them a token.
          const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '24h' });
          res.json({ message: 'Login success', token });
      } else {
          res.status(401).json({ error: 'Invalid credentials' });
      }
  } catch (e) {
      res.status(500).json({ error: 'Server error' });
  }
});

// Get My Profile
app.get('/api/user/me', authenticateToken, (req, res) => {
    try {
        const user = userManager.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        // Remove password from the data before sending it back
        const { password, ...safeUser } = user;
        res.json(safeUser);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Update Profile
app.put('/api/user/me', authenticateToken, (req, res) => {
  const { age, sex, skinSensitivityCode, dailySunMinutes } = req.body;
  
  try {
      const updatedUser = userManager.update(req.user.id, {
          age, sex, skinSensitivityCode, skinColor: skinSensitivityCode, dailySunMinutes
      });
      
      const { password, ...safeUser } = updatedUser;
      res.json(safeUser);
  } catch (e) {
      if (e.message === 'User not found') return res.status(404).json({ error: 'User not found' });
      res.status(500).json({ error: 'Server error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});