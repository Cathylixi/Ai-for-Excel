# 👋 START HERE - Your Next Steps

## 🔴 Current Problem

You tried to run `node server.js` and got this error:
```
node : The term 'node' is not recognized...
```

**Why?** Node.js is not installed on your computer.

---

## ✅ What You Need to Do RIGHT NOW

### Step 1: Install Node.js (10 minutes)

1. **Download Node.js:**
   - Open browser and go to: **https://nodejs.org/**
   - Click the **LTS** button (should be version 20.x or 18.x)
   - Download will start automatically

2. **Install Node.js:**
   - Run the downloaded `.msi` file
   - Click "Next" through the installer
   - **Important:** On the "Tools for Native Modules" screen, check the box that says "Automatically install the necessary tools"
   - Click "Next" and then "Install"
   - Wait for installation to complete

3. **Restart PowerShell:**
   - Close your current PowerShell window
   - Open a new PowerShell window

4. **Verify Installation:**
   ```powershell
   node --version
   npm --version
   ```
   You should see version numbers like `v20.11.0` and `10.5.0`

---

### Step 2: Check if Python is Installed (2 minutes)

After installing Node.js, check if Python was automatically installed:

```powershell
python --version
pip --version
```

**If you see version numbers:** ✅ Python is installed, skip to Step 3

**If you see "not found" or "not recognized":**
1. Go to: **https://www.python.org/downloads/**
2. Download **Python 3.11** or **3.12**
3. Run installer
4. **CRITICAL:** Check the box "Add Python to PATH" at the bottom
5. Click "Install Now"
6. Restart PowerShell and verify with `python --version`

---

### Step 3: Install Project Dependencies (5-10 minutes)

Open PowerShell in your project folder and run these commands one by one:

```powershell
# Navigate to project folder
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel

# Install Python packages
pip install -r requirements_python.txt
pip install -r backend/scripts/requirements_sdtm.txt

# Install Node.js packages for root
npm install

# Install Node.js packages for backend
cd backend
npm install

# Install Node.js packages for frontend
cd ../frontend
npm install
```

---

### Step 4: Set Up Configuration (15-20 minutes)

You need two things:

#### A) MongoDB Database (Free)

1. Go to: **https://www.mongodb.com/cloud/atlas**
2. Click "Try Free" and create account
3. Choose "Free" tier (M0)
4. Create cluster (keep default settings)
5. Create database user (username + password)
6. Add your IP to whitelist (click "Add My Current IP Address")
7. Click "Connect" → "Connect your application"
8. Copy the connection string (looks like: `mongodb+srv://username:password@...`)

#### B) OpenAI API Key (Paid - needs credit card)

1. Go to: **https://platform.openai.com/api-keys**
2. Sign in or create account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)
5. Add some credits to your account (minimum $5 recommended)

#### C) Create Environment File

Create a new file at: `backend\.env`

Paste this content (replace with your actual values):

```env
MONGODB_URI=mongodb+srv://your-username:your-password@cluster0.xxxxx.mongodb.net/ai-excel?retryWrites=true&w=majority
OPENAI_API_KEY=sk-your-actual-openai-key-here
PORT=4000
NODE_ENV=development
DB_NAME=clinicalprotocol
```

---

### Step 5: Generate HTTPS Certificates (2 minutes)

Office Add-ins require HTTPS. Run this:

```powershell
npx office-addin-dev-certs install
```

Click "Yes" if Windows asks for permission.

---

### Step 6: Start the Application! 🎉

**Open TWO PowerShell windows:**

**Window 1:**
```powershell
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel\backend
npm start
```

**Window 2:**
```powershell
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel\frontend
npm run dev-server
```

Both should start without errors!

---

### Step 7: Open in Excel

In the frontend PowerShell window, press `Ctrl+C` to stop, then run:

```powershell
npm start
```

This will automatically open Excel with your add-in loaded!

---

## 📊 Time Estimate

- Installing Node.js: **10 minutes**
- Installing Python (if needed): **5 minutes**
- Installing dependencies: **10 minutes**
- Setting up MongoDB & OpenAI: **20 minutes**
- First run: **5 minutes**

**Total: ~50 minutes** (most of it is waiting for installations and signups)

---

## 🆘 Need Help?

- **Detailed instructions:** See `SETUP_GUIDE.md`
- **Step-by-step checklist:** See `QUICK_START.md`
- **Original requirements:** See `requirements.txt`

---

## 💡 Quick Answer to Your Question

> "why can't I do node?"

**Answer:** Node.js is a program that needs to be installed on your computer, just like Microsoft Word or Excel. Your computer doesn't have it yet, so Windows doesn't recognize the `node` command. Once you install Node.js from https://nodejs.org/, the command will work!

---

**Ready?** Start with Step 1 above! 🚀

---

*This project is a Microsoft Excel Add-in that uses AI to analyze clinical trial documents and generate reports.*


