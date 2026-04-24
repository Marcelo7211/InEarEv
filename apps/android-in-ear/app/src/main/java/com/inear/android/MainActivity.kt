package com.inear.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.inear.android.net.buildPanelUrl
import com.inear.android.ui.AdminWebScreen
import com.inear.android.ui.InEarViewModel
import com.inear.android.ui.LoginScreen
import com.inear.android.ui.MusicianHomeScreen
import com.inear.android.ui.theme.InEarTheme

class MainActivity : ComponentActivity() {
    private val vm: InEarViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            InEarTheme {
                val session by vm.session.collectAsStateWithLifecycle()
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
