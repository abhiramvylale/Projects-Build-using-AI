package com.aquasmart.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aquasmart.app.ui.splash.SplashScreen
import com.aquasmart.app.ui.scanner.ScannerScreen
import com.aquasmart.app.ui.terminal.TerminalScreen
import com.aquasmart.app.ui.dashboard.DashboardScreen

@Composable
fun AquaSmartNavGraph() {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = "dashboard"
    ) {
        composable("splash") {
            SplashScreen(
                onNavigateToScanner = {
                    navController.navigate("scanner") {
                        popUpTo("splash") { inclusive = true }
                    }
                }
            )
        }
        composable("scanner") {
            ScannerScreen(
                onDeviceConnected = {
                    navController.navigate("dashboard") {
                        popUpTo("scanner") { inclusive = true }
                    }
                }
            )
        }
        composable("dashboard") {
            DashboardScreen(
                onNavigateToScanner = {
                    navController.navigate("scanner") {
                        popUpTo("dashboard") { inclusive = true }
                    }
                },
                onNavigateToTerminal = {
                    navController.navigate("terminal")
                }
            )
        }
        composable("terminal") {
            TerminalScreen(
                onNavigateToScanner = {
                    navController.navigate("scanner") {
                        popUpTo("terminal") { inclusive = true }
                    }
                }
            )
        }
    }
}
