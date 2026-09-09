import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';

import App from './App';

// Hold splash until first layout — auto-hide fires on bundle load, before React's first commit, and the bare window flashes.
SplashScreen.preventAutoHideAsync();

registerRootComponent(App);
