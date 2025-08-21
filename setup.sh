#!/bin/bash

# LLX Excel Business Cost Analysis - Quick Setup Script
# This script automates the installation process for the project

echo "🚀 LLX Excel Business Cost Analysis - Setup Script"
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ from https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | sed 's/v//')
REQUIRED_VERSION="16.0.0"

if ! printf '%s\n%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort --check=quiet --version-sort; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js 16+ from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION detected"

# Install root dependencies
echo ""
echo "📦 Installing root dependencies..."
npm install

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd backend
npm install

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd ../frontend
npm install

# Go back to root directory
cd ..

# Install Python dependencies for PDF processing
echo ""
echo "🐍 Installing Python dependencies for PDF processing..."
if command -v python3 &> /dev/null; then
    python3 -m pip install -r requirements_python.txt
    echo "✅ Python dependencies installed successfully"
elif command -v python &> /dev/null; then
    python -m pip install -r requirements_python.txt
    echo "✅ Python dependencies installed successfully"
else
    echo "⚠️  Python not found. Please install Python 3.8+ and run:"
    echo "   pip install -r requirements_python.txt"
fi

# Check if .env file exists in backend
if [ ! -f "backend/.env" ]; then
    echo ""
    echo "⚠️  Environment file not found. Creating template..."
    cat > backend/.env << EOL
# MongoDB Atlas Connection String
# Get this from your MongoDB Atlas dashboard
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/llxexcel?retryWrites=true&w=majority

# OpenAI API Key
# Get this from https://platform.openai.com/api-keys
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
PORT=4000
NODE_ENV=development

# Database Configuration
DB_NAME=llxexcel
COLLECTION_NAME=clinicalprotocol
EOL
    echo "📝 Template .env file created at backend/.env"
    echo "❗ Please edit backend/.env and add your actual MongoDB URI and OpenAI API key"
else
    echo "✅ Environment file already exists"
fi

# Install HTTPS certificates for Office Add-in development
echo ""
echo "🔒 Installing HTTPS development certificates..."
npx office-addin-dev-certs install

# Check if certificates were installed successfully
if [ -d "$HOME/.office-addin-dev-certs" ]; then
    echo "✅ HTTPS certificates installed successfully"
else
    echo "⚠️  HTTPS certificate installation may have failed. You may need to run this manually:"
    echo "   npx office-addin-dev-certs install --force"
fi

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "📋 Next Steps:"
echo "1. Edit backend/.env with your MongoDB URI and OpenAI API key"
echo "2. Ensure Python dependencies are installed: pip install -r requirements_python.txt"
echo "3. Start the backend server: cd backend && npm start"
echo "4. Start the frontend server: cd frontend && npm run dev-server"
echo "5. Open Excel and load the add-in using the manifest.xml file"
echo ""
echo "📚 For detailed instructions, see requirements.txt"
echo "🐛 For troubleshooting, check the troubleshooting section in requirements.txt" 