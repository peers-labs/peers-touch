package com.peerstouch.mobile.features.skills.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.skills.repository.SkillsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class SkillsViewModel @Inject constructor(
    private val skillsRepository: SkillsRepository
) : ViewModel()
