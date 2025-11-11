# 🚀 Quick Start Checklist

## Current Status: Setup Required ⚠️

Your system needs Node.js and Python installed before you can run this project.

---

## ✅ Installation Checklist

### Phase 1: Install Prerequisites

- [ ] **1. Install Node.js**
  - Download from: https://nodejs.org/
  - Choose: **LTS version** (18.x or 20.x)
  - During install: Check "Automatically install necessary tools"
  - After install: **Restart PowerShell**
  - Verify: `node --version` and `npm --version`

- [ ] **2. Install Python** (if not included with Node.js)
  - Download from: https://www.python.org/downloads/
  - Choose: **Python 3.9 or higher**
  - **CRITICAL:** Check "Add Python to PATH"
  - After install: **Restart PowerShell**
  - Verify: `python --version` and `pip --version`

---

### Phase 2: Install Project Dependencies

Open PowerShell in the project folder and run:

```powershell
# Make sure you're in the project root
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel

# Install Python dependencies
pip install -r requirements_python.txt
pip install -r backend/scripts/requirements_sdtm.txt

# Install root Node.js dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Return to root
cd ..
```

- [ ] Python packages installed
- [ ] Root npm packages installed
- [ ] Backend npm packages installed
- [ ] Frontend npm packages installed

---

### Phase 3: Configure Environment

- [ ] **1. Create MongoDB Atlas Account**
  - Go to: https://www.mongodb.com/cloud/atlas
  - Sign up for free tier
  - Create a cluster
  - Click "Connect" → "Connect your application"
  - Copy connection string (save for next step)

- [ ] **2. Get OpenAI API Key**
  - Go to: https://platform.openai.com/api-keys
  - Sign in or create account
  - Click "Create new secret key"
  - Copy the key (starts with `sk-`)

- [ ] **3. Create .env file in backend folder**
  
  Create file: `backend\.env`
  
  ```env
  MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/<dbname>?retryWrites=true&w=majority
  OPENAI_API_KEY=sk-your-actual-key-here
  PORT=4000
  NODE_ENV=development
  DB_NAME=clinicalprotocol
  ```
  
  Replace:
  - `<username>`, `<password>`, `<dbname>` with your MongoDB values
  - `sk-your-actual-key-here` with your OpenAI key

- [ ] **4. Generate HTTPS Certificates**
  ```powershell
  npx office-addin-dev-certs install
  ```

---

### Phase 4: Run the Application

**Open TWO PowerShell windows:**

**Window 1 - Backend Server:**
```powershell
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel\backend
npm start
```
Expected output: `Server is running on port 4000`

**Window 2 - Frontend Development Server:**
```powershell
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel\frontend
npm run dev-server
```
Expected output: `webpack compiled successfully`

- [ ] Backend running on http://localhost:4000
- [ ] Frontend running on https://localhost:3000

---

### Phase 5: Load in Excel

**Option 1: Automatic (Recommended)**
```powershell
cd frontend
npm start
```
This will open Excel automatically with the add-in loaded.

**Option 2: Manual**
1. Open Excel
2. Go to: **Insert** → **Add-ins** → **My Add-ins**
3. Click: **Upload My Add-in**
4. Browse to: `C:\Users\Xi.Li\Desktop\Ai-for-Excel\frontend\manifest.xml`
5. Click: **Upload**

- [ ] Add-in loaded in Excel
- [ ] Task pane opens successfully

---

## 🎉 You're Done!

The Excel add-in should now be running and accessible in Excel.

---

## ⚡ Quick Commands Reference

### Start Backend
```powershell
cd backend
npm start
```

### Start Frontend
```powershell
cd frontend
npm run dev-server
```

### Start Add-in in Excel
```powershell
cd frontend
npm start
```

### Development Mode (auto-restart on changes)
```powershell
cd backend
npm run dev
```

---

## 🐛 Common Issues

**"node is not recognized"**
→ Node.js not installed. Install from https://nodejs.org/ and restart PowerShell

**"python is not recognized"**
→ Python not installed or not in PATH. Reinstall Python with "Add to PATH" checked

**"Port 4000/3000 already in use"**
→ Another process is using the port. Find and kill it:
```powershell
netstat -ano | findstr :4000
taskkill /PID <process_id> /F
```

**"Cannot connect to MongoDB"**
→ Check `.env` file has correct MongoDB URI and credentials

**"OpenAI API error"**
→ Verify API key in `.env` file and check OpenAI account has credits

---

## 📚 More Help

For detailed troubleshooting and setup instructions, see: **SETUP_GUIDE.md**

---

**Last Updated:** Based on your current system state on 2025-10-29


