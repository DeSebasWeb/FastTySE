import { io } from 'socket.io-client';

const URL = import.meta.env.DEV ? 'http://localhost:3001' : '/';

const socket = io(URL, {
  transports: ['websocket', 'polling'],
});

export default socket;
