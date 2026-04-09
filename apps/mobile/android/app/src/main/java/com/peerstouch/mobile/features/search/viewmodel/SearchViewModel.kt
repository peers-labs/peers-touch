package com.peerstouch.mobile.features.search.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.search.repository.SearchRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository
) : ViewModel()
