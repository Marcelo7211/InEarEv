package com.inear.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import com.inear.android.net.buildPanelUrl
import com.inear.android.ui.AdminWebScreen
import com.inear.android.ui.InEarViewModel
import com.inear.android.ui.LoginScreen
import com.inear.android.ui.MusicianHomeScreen
import com.inear.android.ui.theme.InEarTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            InEarTheme {
                val vm = ViewModelProvider(
                    this,
                    ViewModelProvider.AndroidViewModelFactory.getInstance(application),
                )[InEarViewModel::class.java]
                val session by vm.session.collectAsState()
                Surface(Modifier.fillMaxSize()) {
                    when {
                        session.token.isEmpty() -> LoginScreen(vm)
                        session.role == "admin" -> AdminWebScreen(
                            panelUrl = buildPanelUrl(session.apiBase, session.token, session.role),
                            onLogout = { vm.logout() },
                        )
                        else -> MusicianHomeScreen(vm)
                    }
                }
            }
        }
    }
}
