# AI-for-Excel Setup Guide

## ⚠️ Current Status
**Node.js:** ❌ Not Installed  
**Python:** ❌ Not Installed  
**Project Dependencies:** ⏳ Pending Installation

---

## 📋 Step-by-Step Installation Guide

### Step 1: Install Node.js (REQUIRED)

**Why:** Node.js is the runtime environment needed to run the backend server and build the frontend.

**How to Install:**
1. Visit: https://nodejs.org/
2. Download the **LTS version** (recommended: 18.x or 20.x)
3. Run the installer (.msi file)
4. During installation:
   - ✅ Accept the license agreement
   - ✅ Keep default installation path
   - ✅ **IMPORTANT:** Check "Automatically install the necessary tools" (includes Python and VS Build Tools)
   - ✅ Complete the installation
5. **Restart PowerShell/Terminal after installation**
6. Verify installation:
   ```powershell
   node --version
   npm --version
   ```
   You should see version numbers (e.g., v20.x.x and 10.x.x)

---

### Step 2: Install Python (REQUIRED)

**Why:** This project uses Python scripts for PDF processing and SDTM data import.

**Option A: If Node.js installer included Python tools**
- Check if Python was installed:
  ```powershell
  python --version
  ```

**Option B: Manual Installation**
1. Visit: https://www.python.org/downloads/
2. Download **Python 3.9 or higher**
3. Run the installer
4. **CRITICAL:** Check "Add Python to PATH" at the bottom of the installer
5. Click "Install Now"
6. Verify installation:
   ```powershell
   python --version
   pip --version
   ```

---

### Step 3: Install Python Dependencies

After Python is installed, run these commands in PowerShell:

```powershell
# From the project root directory (Ai-for-Excel)
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel

# Install Python packages
pip install -r requirements_python.txt
pip install -r backend/scripts/requirements_sdtm.txt
```

**Required Python Packages:**
- pypdf (PDF annotations)
- pdfplumber (PDF text extraction)
- pdfminer.six (PDF mining)
- pypdfium2 (PDF processing)
- Pillow (image processing)
- pandas (data manipulation)
- pymongo (MongoDB driver)
- xlrd, openpyxl (Excel file handling)

---

### Step 4: Install Node.js Dependencies

After Node.js is installed, run these commands:

```powershell
# Install root dependencies
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

---

### Step 5: Set Up Environment Variables

Create a `.env` file in the `backend` directory:

**Location:** `C:\Users\Xi.Li\Desktop\Ai-for-Excel\backend\.env`

**Contents:**
```env
# MongoDB Connection (Replace with your MongoDB Atlas connection string)
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/<dbname>?retryWrites=true&w=majority

# OpenAI API Key (Get from https://platform.openai.com/api-keys)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Server Configuration
PORT=4000
NODE_ENV=development

# Optional: Database name
DB_NAME=clinicalprotocol
```

**To get MongoDB URI:**
1. Create free account at https://www.mongodb.com/cloud/atlas
2. Create a cluster
3. Click "Connect" → "Connect your application"
4. Copy the connection string
5. Replace `<username>`, `<password>`, and `<dbname>` with your values

**To get OpenAI API Key:**
1. Visit https://platform.openai.com/api-keys
2. Sign in or create account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)
5. Paste into `.env` file

---

### Step 6: Generate Development Certificates (for HTTPS)

Office Add-ins require HTTPS. Run this command:

```powershell
npx office-addin-dev-certs install
```

If you get certificate errors later, run:
```powershell
npx office-addin-dev-certs install --force
```

---

### Step 7: Start the Application

**Option 1: Start Backend Server**
```powershell
cd backend
npm start
# Or for development with auto-restart:
npm run dev
```

**Option 2: Start Frontend Development Server**
```powershell
cd frontend
npm run dev-server
```

**Option 3: Start Both**
Open two PowerShell windows:
- Window 1: Run backend (`cd backend && npm start`)
- Window 2: Run frontend (`cd frontend && npm run dev-server`)

---

### Step 8: Load Add-in in Excel

**Method 1: Automatic (Recommended)**
```powershell
cd frontend
npm start
```
This will automatically open Excel and load the add-in.

**Method 2: Manual**
1. Open Excel
2. Go to **Insert** → **Add-ins** → **My Add-ins**
3. Click **Upload My Add-in**
4. Browse to `C:\Users\Xi.Li\Desktop\Ai-for-Excel\frontend\manifest.xml`
5. Click **Upload**

---

## 🔧 Troubleshooting

### "node is not recognized"
- ✅ Install Node.js from https://nodejs.org/
- ✅ Restart PowerShell after installation
- ✅ Verify: `node --version`

### "python is not recognized"
- ✅ Install Python from https://www.python.org/
- ✅ Ensure "Add to PATH" was checked during installation
- ✅ Restart PowerShell
- ✅ Verify: `python --version`

### Port Already in Use
```powershell
# Find and kill process using port 4000 (backend)
netstat -ano | findstr :4000
taskkill /PID <process_id> /F

# Find and kill process using port 3000 (frontend)
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

### MongoDB Connection Issues
- Check your connection string in `.env`
- Ensure your IP address is whitelisted in MongoDB Atlas
- Verify database user has read/write permissions

### OpenAI API Issues
- Verify API key is valid
- Check OpenAI account has available credits
- Ensure API key has proper permissions

### Office Add-in Not Loading
- Clear Office cache: `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\`
- Restart Excel
- Check browser console for errors (F12 in Excel task pane)

---

## 📦 What Gets Installed

### Node.js Packages:
- **Backend:** Express, MongoDB, OpenAI, Multer, PDF parsers, etc.
- **Frontend:** Webpack, Babel, Office.js, development tools

### Python Packages:
- PDF processing: pypdf, pdfplumber, pdfminer.six
- Data manipulation: pandas
- Database: pymongo
- Excel handling: openpyxl, xlrd

---

## 🚀 Quick Start After Installation

```powershell
# Terminal 1 - Backend
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel\backend
npm start

# Terminal 2 - Frontend
cd C:\Users\Xi.Li\Desktop\Ai-for-Excel\frontend
npm run dev-server
```

Then open Excel and the add-in will be available!

---

## 📝 Next Steps After Setup

1. ✅ Verify backend is running on http://localhost:4000
2. ✅ Verify frontend is running on https://localhost:3000
3. ✅ Open Excel and load the add-in
4. ✅ Test the functionality

---

## 💡 Additional Resources

- Node.js Documentation: https://nodejs.org/docs/
- Office Add-ins Documentation: https://learn.microsoft.com/office/dev/add-ins/
- MongoDB Atlas Guide: https://www.mongodb.com/docs/atlas/
- OpenAI API Documentation: https://platform.openai.com/docs/

---

**Need Help?** Check the `requirements.txt` file for detailed dependency information and troubleshooting tips.


