import { io } from 'socket.io-client';

const URL = import.meta.env.DEV ? 'http://localhost:3001' : '/';
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '') || '';

const socket = io(URL, {
  path: `${basePath}/socket.io/`,
  transports: ['websocket', 'polling'],
});

export default socket;
