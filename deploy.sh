#!/bin/bash

# Убеждаемся, что мы в правильной директории
cd "$(dirname "$0")"

# Добавляем все изменения
git add .

# Создаем коммит
git commit -m "Update WhatsApp server: Fix QR code generation and connection handling"

# Пушим изменения
git push origin main

echo "Changes pushed to repository. Render will automatically deploy the new version."
