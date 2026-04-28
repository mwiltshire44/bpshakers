# 🧂 The Salt & Pepper Collection — Setup Guide

Welcome! This guide will get your website up and running. The whole setup takes about 20–30 minutes, and you only have to do it once.

---

## What you'll need

- A Google account (for Firebase)
- A free Netlify or GitHub account (for hosting)
- A text editor (Notepad works fine on Windows; TextEdit on Mac)

---

## Step 1: Set Up Firebase (your database & storage)

Firebase is Google's free platform that stores your shaker data and images.

1. Go to **https://console.firebase.google.com/**
2. Click **"Create a project"**
3. Give it a name like `salt-pepper-collection`
4. Disable Google Analytics (not needed) → click **Create project**

### Enable Firestore (the database)

5. In the left sidebar, click **Build → Firestore Database**
6. Click **Create database**
7. Choose **Start in test mode** → click Next
8. Pick any location (closest to you) → click **Enable**

### Enable Storage (for images)

9. In the left sidebar, click **Build → Storage**
10. Click **Get started**
11. Choose **Start in test mode** → click Next → click **Done**

### Enable Authentication (for admin login)

12. In the left sidebar, click **Build → Authentication**
13. Click **Get started**
14. Click the **Email/Password** provider → toggle it **Enabled** → click Save

### Create your admin account

15. Still in Authentication, click the **Users** tab
16. Click **Add user**
17. Enter your email address and choose a strong password
18. Click **Add user**
19. ✅ Repeat for any other admins (e.g. your mom)

### Get your Firebase config

20. Click the **gear icon** (⚙️) next to "Project Overview" → **Project settings**
21. Scroll down to "Your apps" → click the **</>** (Web) icon
22. Give it a nickname like `salt-pepper-web` → click **Register app**
23. You'll see a block of code with your `firebaseConfig`. Copy these values.

---

## Step 2: Add Your Firebase Config to the Website

1. Open the file `js/firebase-config.js` in a text editor
2. Replace each placeholder with your actual values:

```javascript
export const firebaseConfig = {
  apiKey: "AIzaSy...",              // ← your actual apiKey
  authDomain: "salt-pepper-12345.firebaseapp.com",
  projectId: "salt-pepper-12345",
  storageBucket: "salt-pepper-12345.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

3. Save the file.

---

## Step 3: Set Firebase Security Rules

Right now Firebase is in "test mode" which is open. Before you launch, tighten it up:

### Firestore Rules

In Firebase Console → Firestore → **Rules** tab, replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Anyone can read sets
    match /sets/{setId} {
      allow read: if true;
      // Only signed-in admins can write
      allow write: if request.auth != null;
    }
  }
}
```

Click **Publish**.

### Storage Rules

In Firebase Console → Storage → **Rules** tab, replace everything with:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /sets/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

Click **Publish**.

---

## Step 4: Host the Website (Free with Netlify)

Netlify hosts your website files for free, forever.

1. Go to **https://netlify.com** and create a free account
2. On your dashboard, look for a box that says **"Deploy manually"** or drag-and-drop
3. Drag your entire `saltandpepper` folder onto that box
4. Wait a few seconds — Netlify gives you a URL like `https://wonderful-shakers-abc123.netlify.app`
5. That's your website! 🎉

### Optional: Get a custom domain name

If you want a proper address like `www.mamashakerscollection.com`:
- Buy a domain from **Namecheap.com** (~$12/year) or **Porkbun.com** (~$10/year)
- In Netlify → Domain settings → Add custom domain → follow the instructions

---

## Step 5: Updating the Site Later

Whenever you update files (rare — probably never needed), just drag the folder to Netlify again.

When your mom adds new shaker sets, she just goes to:
`https://your-site-url/admin/login.html` → signs in → clicks **+ Add New Set**

No technical knowledge needed beyond that!

---

## File Structure

```
saltandpepper/
├── index.html          ← Public gallery page
├── set.html            ← Individual set detail page
├── css/
│   └── main.css        ← All styles
├── js/
│   └── firebase-config.js  ← ⚠️ Fill this in with your Firebase values
├── img/
│   └── placeholder.svg ← Shown when image is missing
└── admin/
    ├── login.html      ← Admin sign-in page
    ├── index.html      ← Admin panel (manage sets)
    └── edit.html       ← Add / edit a set (with image cropper)
```

---

## Frequently Asked Questions

**How much does this cost?**
Firebase free tier supports up to 1GB storage and 50,000 reads per day — more than enough for a family collection that might have hundreds of sets. Netlify hosting is free. If the collection grows to thousands of sets with heavy traffic, you might one day hit Firebase limits, but that's very unlikely for years.

**What if I forget the admin password?**
Go to Firebase Console → Authentication → Users → find the email → click the three dots → Reset password.

**Can multiple people be admins?**
Yes! Just add more users in Firebase Console → Authentication → Users.

**The images — what size should they be?**
The cropper automatically crops everything to 800×800 pixels. This is plenty sharp for screens and keeps file sizes reasonable.

**Can I change the website name?**
Yes — search for "The Salt & Pepper Shakers" and "The Salt & Pepper Collection" across the HTML files and replace with whatever you'd like to call it.

---

## Need help?

If you get stuck on any step, don't panic. Each step above is a common process and there are good tutorials for each on YouTube (search "Firebase setup tutorial" or "Netlify deploy tutorial").
