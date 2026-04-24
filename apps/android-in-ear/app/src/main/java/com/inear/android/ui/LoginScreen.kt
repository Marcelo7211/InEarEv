package com.inear.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun LoginScreen(vm: InEarViewModel) {
    var api by remember { mutableStateOf("http://192.168.0.10:3847") }
    var user by remember { mutableStateOf("musician1") }
    var pass by remember { mutableStateOf("musician1") }
    val err by vm.error.collectAsState()

    Box(
        Modifier
            .fillMaxSize()
            .padding(20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            colors =
                CardDefaults.cardColors(
                    containerColor = Color(0xFF111925),
                ),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "inEar Retorno",
                    style = MaterialTheme.typography.headlineSmall,
                    color = Color(0xFFeef4fb),
                )
                Text(
                    "Entre no painel do músico e controle seu retorno com a mesma linguagem visual do desktop.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF99abc1),
                )
                Card(
                    shape = RoundedCornerShape(18.dp),
                    colors =
                        CardDefaults.cardColors(
                            containerColor = Color(0xFF0c131d),
                        ),
                ) {
                    Column(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            "Acesso rápido",
                            style = MaterialTheme.typography.titleSmall,
                            color = Color(0xFF8ab4ff),
                            fontWeight = FontWeight.Bold,
                        )
                        OutlinedTextField(
                            value = api,
                            onValueChange = { api = it },
                            label = { Text("Endereço do desktop") },
                            supportingText = { Text("Exemplo: http://IP:3847") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        )
                        OutlinedTextField(
                            value = user,
                            onValueChange = { user = it },
                            label = { Text("Usuário") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                        OutlinedTextField(
                            value = pass,
                            onValueChange = { pass = it },
                            label = { Text("Senha") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                        )
                    }
                }
                if (err != null) {
                    Text(err!!, color = MaterialTheme.colorScheme.error)
                }
                Button(
                    onClick = {
                        vm.clearError()
                        vm.login(api, user, pass)
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Entrar")
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    "Dica: use o mesmo IP mostrado no desktop.",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFF7f93ab),
                )
            }
        }
    }
}
