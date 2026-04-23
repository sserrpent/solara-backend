/**
 * Simple JSON-based User Manager
 * ------------------------------
 * This file replaces a complex database (like SQL) with a simple text user.
 * It's easier to understand and run for a student project.
 * 
 * Responsibilities:
 * 1. Read users from 'users.json'.
 * 2. Save new users to 'users.json'.
 * 3. Find users by email or ID.
 */

// 'fs' (File System) is a built-in Node.js module to read/write files.
const fs = require('fs');

// 'path' helps us build file paths that work on both Windows and Mac.
const path = require('path');

// Defined the file path where our data lives:
// __dirname is the current folder (backend/src).
// '..' goes up one level (backend).
// 'data' goes into the data folder.
const usersFilePath = path.join(__dirname, '..', 'data', 'users.json');

// --- Initialization ---
// When the server starts, we check if users.json exists.
// If it doesn't exist, we create it with an empty list '[]'.
if (!fs.existsSync(usersFilePath)) {
    fs.writeFileSync(usersFilePath, JSON.stringify([], null, 2));
}

// --- Helper Functions ---

/**
 * HELPER: getUsers
 * Reads the 'users.json' file and converts it from text to a JavaScript Array.
 */
function getUsers() {
    try {
        // 'utf8' means read it as text
        const data = fs.readFileSync(usersFilePath, 'utf8');
        return JSON.parse(data); // Convert text "[]" to array []
    } catch (err) {
        // If reading fails (e.g. file corrupted), return empty array so we don't crash
        return [];
    }
}

/**
 * HELPER: saveUsers
 * Takes a JavaScript Array of users and saves it back to the text file.
 */
function saveUsers(users) {
    // null, 2 makes the JSON file pretty and readable (adds spaces)
    const textData = JSON.stringify(users, null, 2);
    fs.writeFileSync(usersFilePath, textData);
}

// --- Exported Methods ---
// These are the functions other files (like server.js) can use.

module.exports = {
    // 1. Find a user by their email (used for Login)
    findByEmail: (email) => {
        const users = getUsers(); // Get all users
        // .find details: searches the array and returns the first match
        return users.find(u => u.email === email);
    },

    // 2. Find a user by their unique ID (used for getting Profile)
    findById: (id) => {
        const users = getUsers();
        // We use '==' to match even if one is string "1" and other is number 1
        return users.find(u => u.id == id);
    },

    // 3. Create a new user (used for Registration)
    create: (userData) => {
        const users = getUsers();
        
        // Check if email already exists to prevent duplicates
        if (users.find(u => u.email === userData.email)) {
            throw new Error('User already exists');
        }

        // Create the new user object
        const newUser = {
            id: Date.now(), // Use current time as a simple unique ID
            ...userData,    // Copy all the form data (email, age, sex, etc.)
            createdAt: new Date().toISOString() // Save when they joined
        };

        // Add to our list and save to file
        users.push(newUser);
        saveUsers(users);
        
        return newUser; // Return the user we just made
    },

    // 4. Update an existing user (used for Editing Profile)
    update: (id, updates) => {
        const users = getUsers();
        // Find the index (position) of the user in the array
        const index = users.findIndex(u => u.id == id);
        
        if (index === -1) {
            throw new Error('User not found'); // Stop if they don't exist
        }

        // Update the user at that position
        // ...users[index] keeps their old data
        // ...updates overwrites with the new data
        users[index] = { ...users[index], ...updates };
        
        // Save to file
        saveUsers(users);
        return users[index];
    }
};
