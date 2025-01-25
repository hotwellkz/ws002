FROM node:18

WORKDIR /app

# Создаем директорию для сессий и даем права на запись
RUN mkdir -p /app/sessions && chmod 777 /app/sessions

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Открываем порт
EXPOSE 10000

# Запускаем сервер
CMD ["npm", "start"]
